import * as THREE from 'three';
import { VoxelGrid } from './VoxelGrid';

/**
 * Dữ liệu instance đã "phẳng hoá" từ VoxelGrid.
 * Cả editor (r3f) lẫn game đều dùng chung hàm này để render giống hệt nhau.
 * `positions` là TÂM của mỗi khối (cell + 0.5) để khối nằm gọn trong ô lưới.
 */
export interface InstanceData {
  count: number;
  /** [x,y,z] tâm mỗi khối, trùng thứ tự với instanceId. */
  positions: [number, number, number][];
  /** Toạ độ ô lưới (nguyên) tương ứng instanceId — dùng cho raycast/đặt khối. */
  cells: [number, number, number][];
  colors: string[];
}

export function buildInstanceData(grid: VoxelGrid): InstanceData {
  const positions: [number, number, number][] = [];
  const cells: [number, number, number][] = [];
  const colors: string[] = [];
  for (const { x, y, z, voxel } of grid.entries()) {
    positions.push([x + 0.5, y + 0.5, z + 0.5]);
    cells.push([x, y, z]);
    colors.push(voxel.color);
  }
  return { count: positions.length, positions, cells, colors };
}

/**
 * Tạo InstancedMesh three.js từ grid — tiện cho GAME dùng lại trực tiếp.
 * (Editor render bằng r3f nhưng cùng chung buildInstanceData ở trên.)
 */
export function createVoxelMesh(grid: VoxelGrid): THREE.InstancedMesh {
  const data = buildInstanceData(grid);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ vertexColors: false });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(data.count, 1));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(Math.max(data.count, 1) * 3),
    3,
  );
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < data.count; i++) {
    const [px, py, pz] = data.positions[i];
    m.setPosition(px, py, pz);
    mesh.setMatrixAt(i, m);
    c.set(data.colors[i]);
    mesh.setColorAt(i, c);
  }
  mesh.count = data.count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
