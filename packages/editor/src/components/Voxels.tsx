import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { VoxelGrid, WALL_HEX, buildInstanceData } from '@voxel/core';
import { useEditor } from '../store';
import { useLayers } from '../lib/useLayers';
import { brickMaps, brickShade } from '../lib/brickTexture';
import { beginDragFace, useDrag } from './dragStore';
import { useHoverBlock } from './hoverStore';
import { useInput } from './input';

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

function nextCapacity(count: number, current: number): number {
  let cap = Math.max(current, 64);
  while (cap < count) cap *= 2;
  return cap;
}

export type Cell = [number, number, number];

interface VoxelsProps {
  onHover: (cell: Cell | null) => void;
}

interface ChunkData {
  count: number;
  positions: [number, number, number][];
  cells: Cell[];
  colors: string[];
}

const EMPTY_CHUNK: ChunkData = { count: 0, positions: [], cells: [], colors: [] };

export function Voxels({ onHover }: VoxelsProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const colorFilter = useEditor((s) => s.colorFilter);
  const { hiddenVoxels } = useLayers();

  // Rebuild dữ liệu instance mỗi khi grid đổi (theo version). Lọc theo màu và theo layer bị tắt.
  const data = useMemo(() => {
    const full = buildInstanceData(grid);
    const keep = colorFilter.length ? new Set(colorFilter) : null;
    if (!keep && !hiddenVoxels.size) return full;
    const positions: [number, number, number][] = [];
    const cells: [number, number, number][] = [];
    const colors: string[] = [];
    for (let i = 0; i < full.count; i++) {
      if (keep && !keep.has(full.colors[i])) continue;
      const [x, y, z] = full.cells[i];
      if (hiddenVoxels.has(VoxelGrid.key(x, y, z))) continue;
      positions.push(full.positions[i]);
      cells.push(full.cells[i]);
      colors.push(full.colors[i]);
    }
    return { count: positions.length, positions, cells, colors };
  }, [grid, version, colorFilter, hiddenVoxels]);

  // Tách tường ra mesh riêng để nó đeo được vật liệu đá: một instancedMesh chỉ có đúng một material,
  // nên muốn tường trông khác hẳn thì phải là hai mesh.
  const [blocks, walls] = useMemo(() => {
    const wallHex = WALL_HEX.toUpperCase();
    let hasWall = false;
    for (const c of data.colors) {
      if (c.toUpperCase() === wallHex) {
        hasWall = true;
        break;
      }
    }
    if (!hasWall) return [data as ChunkData, EMPTY_CHUNK];

    const a: ChunkData = { count: 0, positions: [], cells: [], colors: [] };
    const b: ChunkData = { count: 0, positions: [], cells: [], colors: [] };
    for (let i = 0; i < data.count; i++) {
      const target = data.colors[i].toUpperCase() === wallHex ? b : a;
      target.positions.push(data.positions[i]);
      target.cells.push(data.cells[i]);
      target.colors.push(data.colors[i]);
    }
    a.count = a.positions.length;
    b.count = b.positions.length;
    return [a, b];
  }, [data]);

  return (
    <>
      <VoxelChunk data={blocks} onHover={onHover} />
      <VoxelChunk data={walls} onHover={onHover} wall />
    </>
  );
}

/** Một mẻ khối cùng vật liệu. Tách ra để tường và khối màu dùng chung đúng logic chuột/hover. */
function VoxelChunk({
  data,
  onHover,
  wall = false,
}: {
  data: ChunkData;
  onHover: (cell: Cell | null) => void;
  wall?: boolean;
}) {
  const mode = useEditor((s) => s.mode);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const brick = useMemo(() => (wall ? brickMaps() : null), [wall]);

  const cellsRef = useRef(data.cells);
  cellsRef.current = data.cells;
  const colorsRef = useRef(data.colors);
  colorsRef.current = data.colors;

  const [capacity, setCapacity] = useState(() => nextCapacity(data.count, 0));
  useEffect(() => {
    setCapacity((cap) => nextCapacity(data.count, cap));
  }, [data.count]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Đảm bảo buffer màu luôn tồn tại & đúng kích thước (ổn định qua HMR),
    // nếu không instanceColor có thể bị mất -> khối hiển thị đen.
    if (!mesh.instanceColor || mesh.instanceColor.count !== capacity) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(capacity * 3),
        3,
      );
    }
    for (let i = 0; i < data.count; i++) {
      const [px, py, pz] = data.positions[i];
      tmpMatrix.setPosition(px, py, pz);
      mesh.setMatrixAt(i, tmpMatrix);
      if (wall) {
        // Màu gạch nằm sẵn trong vân, nên instanceColor chỉ còn việc chỉnh sáng/tối từng khối.
        // Nhân thêm hex xám của tường vào đây là tối gấp đôi và mất luôn sắc đỏ.
        const [cx, cy, cz] = data.cells[i];
        tmpColor.setScalar(brickShade(cx, cy, cz));
      } else {
        tmpColor.set(data.colors[i]);
      }
      mesh.setColorAt(i, tmpColor);
    }
    mesh.count = data.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // BẮT BUỘC: raycaster kiểm tra boundingSphere/Box của cả mesh trước khi
    // test từng instance. Không tính lại thì các khối mới nằm ngoài vùng cũ
    // sẽ bị bỏ qua -> chuột chỉ vào khối bị "miss".
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }, [data, capacity, wall]);

  const targetCell = (e: ThreeEvent<PointerEvent>): Cell | null => {
    if (e.instanceId == null || !e.face) return null;
    const [cx, cy, cz] = cellsRef.current[e.instanceId];
    const { erase, pick } = useInput.getState();
    // Xóa/sơn/hút màu nhắm vào chính khối; đặt nhắm vào ô áp mặt.
    if (erase || pick || mode !== 'place') return [cx, cy, cz];
    const n = e.face.normal;
    return [cx + Math.round(n.x), cy + Math.round(n.y), cz + Math.round(n.z)];
  };

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return; // chỉ chuột trái
    const { rotate, pan, erase, pick } = useInput.getState();
    if (rotate || pan) return; // đang giữ phím xoay/pan -> nhường cho camera
    if (e.instanceId == null || !e.face) return;
    e.stopPropagation();
    const cell = cellsRef.current[e.instanceId];
    if (pick) {
      // Eyedropper: hút màu từ khối đang trỏ.
      const v = useEditor.getState().grid.get(cell[0], cell[1], cell[2]);
      if (v) useEditor.getState().setColor(v.color);
      return;
    }
    // Bắt đầu kéo từ mặt khối; thả chuột (DragFill) mới fill cả vùng.
    beginDragFace(cell, e.face.normal, erase ? 'remove' : mode);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (useDrag.getState().drag) return; // đang kéo -> khỏi tính hover
    // HUD toạ độ đọc CHÍNH khối bị trỏ, không phải ô đích của thao tác: ở chế độ đặt, ô đích là ô
    // trống áp mặt, hiện số đó ra thì người dùng đọc được toạ độ của một khối chưa tồn tại.
    if (e.instanceId != null) {
      const [cx, cy, cz] = cellsRef.current[e.instanceId];
      useHoverBlock.getState().setBlock({
        cell: [cx, cy, cz],
        color: colorsRef.current[e.instanceId],
      });
    }
    const cell = targetCell(e);
    if (cell) {
      e.stopPropagation();
      onHover(cell);
    }
  };

  const clearHover = () => {
    onHover(null);
    useHoverBlock.getState().setBlock(null);
  };

  return (
    <instancedMesh
      ref={meshRef}
      // key theo capacity: chỉ tạo lại buffer khi cần lớn hơn.
      key={capacity}
      args={[undefined, undefined, capacity]}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerOut={clearHover}
    >
      <boxGeometry args={[1, 1, 1]} />
      {brick ? (
        // Gạch: nhám hết cỡ, không ánh kim, bump cho mạch vữa lõm xuống — nhìn là biết ngay không
        // phải khối màu bắn được.
        <meshStandardMaterial
          map={brick.map}
          bumpMap={brick.bump}
          bumpScale={0.4}
          roughness={1}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      ) : (
        <meshStandardMaterial
          roughness={0.75}
          metalness={0.05}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      )}
    </instancedMesh>
  );
}
