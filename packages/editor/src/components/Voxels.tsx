import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { buildInstanceData } from '@voxel/core';
import { useEditor } from '../store';
import { beginDragFace, useDrag } from './dragStore';
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

export function Voxels({ onHover }: VoxelsProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const mode = useEditor((s) => s.mode);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Rebuild dữ liệu instance mỗi khi grid đổi (theo version).
  const data = useMemo(() => buildInstanceData(grid), [grid, version]);
  const cellsRef = useRef(data.cells);
  cellsRef.current = data.cells;

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
      tmpColor.set(data.colors[i]);
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
  }, [data, capacity]);

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
    const cell = targetCell(e);
    if (cell) {
      e.stopPropagation();
      onHover(cell);
    }
  };

  return (
    <instancedMesh
      ref={meshRef}
      // key theo capacity: chỉ tạo lại buffer khi cần lớn hơn.
      key={capacity}
      args={[undefined, undefined, capacity]}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        roughness={0.75}
        metalness={0.05}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </instancedMesh>
  );
}
