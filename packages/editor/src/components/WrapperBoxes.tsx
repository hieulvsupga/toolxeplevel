import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { wrapperInnerCells } from '@voxel/core';
import { useEditor } from '../store';

/** Màu theo loại lớp bọc — đều khác hẳn màu cam của vùng chọn. */
const KIND_COLOR: Record<string, string> = {
  ice: '#7fd6ff',
  shield: '#b79cff',
};
const ICE_COLOR = KIND_COLOR.ice;
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
export function WrapperBoxes() {
  const wrappers = useEditor((s) => s.wrappers);
  const focused = useEditor((s) => s.focusedWrapper);
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);

  const boxes = useMemo(
    () =>
      wrappers.map((w) => ({
        id: w.id,
        color: KIND_COLOR[w.kind] ?? ICE_COLOR,
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
      ? { cells: wrapperInnerCells(grid, w), color: KIND_COLOR[w.kind] ?? ICE_COLOR }
      : { cells: [], color: ICE_COLOR };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrappers, focused, grid, version]);

  if (!boxes.length) return null;

  return (
    <group>
      {boxes.map((b) => {
        const on = b.id === focused;
        const dim = focused !== null && !on;
        return (
          <group key={b.id}>
            <mesh position={b.center} scale={b.scale}>
              <boxGeometry args={[1, 1, 1]} />
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
    </group>
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
