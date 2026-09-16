import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { gameColorById, wrapperInnerCells } from '@voxel/core';
import { useEditor } from '../store';
import { useHoverBlock } from './hoverStore';
import { useInput } from './input';
import { useCellFocus } from './WrapperCellsPanel';
import type { Cell } from './Voxels';

/** Màu khung theo loại lớp bọc — đều khác hẳn màu cam của vùng chọn. */
const ICE_COLOR = '#7fd6ff';
const LARGE_COLOR = '#b79cff';

/**
 * Khối lớn vẽ khung bằng ĐÚNG màu game của nó: cục lớn trong game sẽ mang màu đó, nên nhìn khung là
 * biết luôn màu sắp ra, khỏi phải dò trong danh sách.
 */
const wrapperColor = (w: { kind: string; color?: number }) =>
  w.kind === 'largeVoxel' ? (gameColorById(w.color ?? 1)?.hex ?? LARGE_COLOR) : ICE_COLOR;
/** Lớp bọc đang được soi: trắng cho nổi hẳn lên giữa các hộp xanh còn lại. */
const FOCUS_COLOR = '#ffffff';
/** Nới khung ra chút cho khỏi trùng mặt khối bên trong (trùng thì nhấp nháy). */
const PAD = 0.04;

const tmpMatrix = new THREE.Matrix4();

/** 12 cạnh của một hộp theo toạ độ thế giới — ô [x] chiếm khoảng x..x+1. */
function boxEdges(min: [number, number, number], max: [number, number, number]) {
  const [x0, y0, z0] = [min[0] - PAD, min[1] - PAD, min[2] - PAD];
  const [x1, y1, z1] = [max[0] + 1 + PAD, max[1] + 1 + PAD, max[2] + 1 + PAD];
  const c: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return pairs.flatMap(([a, b]) => [c[a], c[b]]);
}

/**
 * Khung của các lớp bọc trong scene.
 *
 * Vẽ nét liền (vùng chọn là nét gạch đứt) và tắt `depthTest`: lớp bọc thường bọc khối nằm sâu trong
 * cụm, khung bị khối che thì không biết nó đang ở đâu.
 *
 * Lớp đang được soi (trỏ/bấm vào dòng trong bảng lớp bọc) thì sáng trắng, dày nét, và tô sáng luôn
 * TỪNG KHỐI bên trong; các lớp còn lại mờ đi. Level có dăm cái hộp chồng chéo thì nhìn khung không
 * thể biết dòng nào là hộp nào.
 */
interface WrapperBoxesProps {
  /** Báo ô đích ra ngoài (đúng hàm mà `Voxels`/`Ground` dùng) để khung xem trước vẽ đúng chỗ. */
  onHover: (cell: Cell | null) => void;
}

export function WrapperBoxes({ onHover }: WrapperBoxesProps) {
  const wrappers = useEditor((s) => s.wrappers);
  const focused = useEditor((s) => s.focusedWrapper);
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const mode = useEditor((s) => s.mode);

  /**
   * Trỏ vào MẶT của một lớp bọc thì lấy nó làm điểm tựa: ô đích là ô ngay ngoài mặt đó, y như khi
   * trỏ vào mặt một khối thật.
   *
   * Không có cái này thì chỉ dựng được từ sàn hoặc từ khối thường — xếp chồng khối lớn lên nhau
   * (thứ hay gặp nhất khi dựng bằng khối lớn) sẽ không có chỗ bấm.
   *
   * Xác định mặt bằng cách so điểm chạm với sáu mặt phẳng của hộp chứ không đọc `face.normal`: mesh
   * ở đây bị scale nên pháp tuyến trả về là của khối lập phương gốc, phải quy đổi thêm một lần nữa.
   */
  const faceAnchorOf = (lo: number[], hi: number[], e: ThreeEvent<PointerEvent>) => {
    let axis = 0;
    let sign: 1 | -1 = 1;
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const v = e.point.getComponent(i);
      if (Math.abs(v - lo[i]) < best) {
        best = Math.abs(v - lo[i]);
        axis = i;
        sign = -1;
      }
      if (Math.abs(v - hi[i]) < best) {
        best = Math.abs(v - hi[i]);
        axis = i;
        sign = 1;
      }
    }
    const cell: Cell = [Math.floor(e.point.x), Math.floor(e.point.y), Math.floor(e.point.z)];
    for (let i = 0; i < 3; i++) {
      // Hai trục còn lại kẹp vào trong hộp: điểm chạm nằm đúng mép thì `floor` có thể rơi ra ngoài.
      if (i !== axis) cell[i] = Math.min(hi[i] - 1, Math.max(lo[i], cell[i]));
    }
    cell[axis] = sign > 0 ? hi[axis] : lo[axis] - 1;
    const normal: Cell = [0, 0, 0];
    normal[axis] = sign;
    return { cell, normal };
  };

  /**
   * Trỏ vào lớp bọc thì lấy nó làm điểm tựa. Lớp bọc đặc thì mặt tựa là mặt của cả hộp; lớp bọc có
   * hình riêng thì là mặt của ĐÚNG ô bị trỏ vào — hộp bao của nó chỉ là cái khung ảo, dựng theo
   * khung đó sẽ ra chỗ lơ lửng cách hình thật vài ô.
   */
  const onFaceMove = (w: (typeof wrappers)[number]) => (e: ThreeEvent<PointerEvent>) => {
    // Chỉ chen vào ở chế độ đặt lớp bọc; các công cụ khác vẫn nhìn xuyên qua hộp như trước.
    if (mode !== 'wrapper') return;
    const { rotate, pan } = useInput.getState();
    if (rotate || pan) return;
    e.stopPropagation();
    const c = w.cells && e.instanceId !== undefined ? w.cells[e.instanceId] : null;
    const { cell, normal } = c
      ? faceAnchorOf([c.x, c.y, c.z], [c.x + 1, c.y + 1, c.z + 1], e)
      : faceAnchorOf([w.min.x, w.min.y, w.min.z], [w.max.x + 1, w.max.y + 1, w.max.z + 1], e);
    onHover(cell);
    useHoverBlock.getState().setTargetNormal(normal);
  };

  const boxes = useMemo(
    () =>
      wrappers.map((w) => ({
        id: w.id,
        w,
        color: wrapperColor(w),
        points: boxEdges([w.min.x, w.min.y, w.min.z], [w.max.x, w.max.y, w.max.z]),
        center: [
          (w.min.x + w.max.x + 1) / 2,
          (w.min.y + w.max.y + 1) / 2,
          (w.min.z + w.max.z + 1) / 2,
        ] as [number, number, number],
        scale: [
          w.max.x - w.min.x + 1 + PAD * 2,
          w.max.y - w.min.y + 1 + PAD * 2,
          w.max.z - w.min.z + 1 + PAD * 2,
        ] as [number, number, number],
      })),
    [wrappers],
  );

  /** Khối bên trong lớp đang soi — chỉ tính cho một lớp nên không tốn gì. */
  const focus = useMemo(() => {
    const w = wrappers.find((x) => x.id === focused);
    return w
      ? {
          // Chỉ tô ô CÓ KHỐI: `wrapperInnerCells` giờ trả về mọi ô của hộp (kể cả ô trống) vì file
          // cần thế, còn tô sáng thì tô vào ô trống chỉ làm rối.
          cells: wrapperInnerCells(w).filter((p) => grid.has(p.x, p.y, p.z)),
          color: wrapperColor(w),
        }
      : { cells: [], color: ICE_COLOR };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrappers, focused, grid, version]);

  if (!boxes.length) return null;

  return (
    <group>
      {boxes.map((b) => {
        const on = b.id === focused;
        const dim = focused !== null && !on;
        const out = () => {
          if (mode === 'wrapper') onHover(null);
        };
        // Lớp bọc có hình riêng: vẽ ĐÚNG các ô nó chiếm, bỏ khung hộp. Khung hộp bao của một quả
        // cầu là cái hộp vuông chẳng giống hình nào — nhìn vào không biết mình đang dựng cái gì.
        if (b.w.cells) {
          return (
            <ShapeCells
              key={b.id}
              cells={b.w.cells}
              color={on ? FOCUS_COLOR : b.color}
              opacity={on ? 0.34 : dim ? 0.08 : 0.2}
              onPointerMove={onFaceMove(b.w)}
              onPointerOut={out}
            />
          );
        }
        return (
          <group key={b.id}>
            <mesh
              position={b.center}
              scale={b.scale}
              onPointerMove={onFaceMove(b.w)}
              onPointerOut={out}
            >
              <boxGeometry args={[1, 1, 1]} />
              {/* Ruột chỉ tô rất mờ, KHUNG mới là thứ để nhìn: tô đặc thì che mất khối bên trong và
                  nhiều hộp chồng lên nhau là rối không đọc nổi. */}
              <meshBasicMaterial
                color={on ? FOCUS_COLOR : b.color}
                transparent
                opacity={on ? 0.26 : dim ? 0.06 : 0.16}
                depthWrite={false}
              />
            </mesh>
            <Line
              points={b.points}
              segments
              color={on ? FOCUS_COLOR : b.color}
              lineWidth={on ? 4 : 2}
              transparent
              opacity={on ? 1 : dim ? 0.35 : 0.9}
              depthTest={false}
              renderOrder={on ? 12 : 10}
            />
          </group>
        );
      })}
      {focus.cells.length > 0 && <InnerHighlight cells={focus.cells} color={focus.color} />}
      <CellFocus />
    </group>
  );
}

/**
 * Vẽ HÌNH THẬT của lớp bọc không đặc: mỗi ô một cube mờ.
 *
 * Dùng instanced mesh vì mấy hình này to — quả cầu của Level_79 là 416 ô, vỏ băng của Level_393 là
 * 772 ô; từng ô một mesh là tụt hẳn khung hình.
 */
function ShapeCells({
  cells,
  color,
  opacity,
  onPointerMove,
  onPointerOut,
}: {
  cells: { x: number; y: number; z: number }[];
  color: string;
  opacity: number;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < cells.length; i++) {
      tmpMatrix.setPosition(cells[i].x + 0.5, cells[i].y + 0.5, cells[i].z + 0.5);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells]);

  return (
    <instancedMesh
      ref={ref}
      key={cells.length}
      args={[undefined, undefined, cells.length]}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      renderOrder={11}
    >
      {/* Nới ra đúng bằng khung hộp cũ: trùng mặt khối bên trong là nhấp nháy. */}
      <boxGeometry args={[1 + PAD * 2, 1 + PAD * 2, 1 + PAD * 2]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </instancedMesh>
  );
}

/**
 * Ô đang trỏ trong bảng liệt kê — một cái khung trắng đặc để mắt bắt ngay.
 *
 * Bảng chỉ cho toạ độ dạng số; không soi ra scene thì người dùng phải tự dò "ô -9, -2, 3 là ô nào"
 * giữa mấy trăm ô giống hệt nhau.
 */
function CellFocus() {
  const cell = useCellFocus((s) => s.cell);
  if (!cell) return null;
  return (
    <mesh position={[cell.x + 0.5, cell.y + 0.5, cell.z + 0.5]} renderOrder={14}>
      <boxGeometry args={[1.12, 1.12, 1.12]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

/** Tô sáng từng khối nằm trong lớp bọc đang soi. */
function InnerHighlight({
  cells,
  color,
}: {
  cells: { x: number; y: number; z: number }[];
  color: string;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < cells.length; i++) {
      tmpMatrix.setPosition(cells[i].x + 0.5, cells[i].y + 0.5, cells[i].z + 0.5);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells]);

  return (
    <instancedMesh
      ref={ref}
      key={cells.length}
      args={[undefined, undefined, cells.length]}
      renderOrder={13}
    >
      {/* Nhô ra chút để không trùng mặt khối (trùng thì nhấp nháy). */}
      <boxGeometry args={[1.05, 1.05, 1.05]} />
      <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} />
    </instancedMesh>
  );
}
