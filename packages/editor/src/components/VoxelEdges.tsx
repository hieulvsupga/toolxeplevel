import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { VoxelGrid } from '@voxel/core';
import { useEditor } from '../store';
import { useLayers } from '../lib/useLayers';

// 12 cạnh của 1 ô đơn vị, mô tả bằng offset các đỉnh (0/1) theo x,y,z.
const EDGES: [number, number, number, number, number, number][] = [
  // đáy
  [0, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 1, 0],
  [1, 1, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 0],
  // nắp
  [0, 0, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1],
  [1, 1, 1, 0, 1, 1],
  [0, 1, 1, 0, 0, 1],
  // cạnh đứng
  [0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 0, 1],
  [1, 1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1, 1],
];

/** Viền mờ (cùng tông lưới sàn) ở cạnh mỗi khối để phân biệt các cube cạnh nhau. */
export function VoxelEdges() {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const colorFilter = useEditor((s) => s.colorFilter);
  const { hiddenVoxels } = useLayers();
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const positions = useMemo(() => {
    const keep = colorFilter.length ? new Set(colorFilter) : null;
    const pts: number[] = [];
    for (const { x, y, z, voxel } of grid.entries()) {
      if (keep && !keep.has(voxel.color)) continue; // ẩn viền của khối bị lọc
      if (hiddenVoxels.has(VoxelGrid.key(x, y, z))) continue; // ẩn viền của layer đang tắt
      for (const [ax, ay, az, bx, by, bz] of EDGES) {
        pts.push(x + ax, y + ay, z + az, x + bx, y + by, z + bz);
      }
    }
    return new Float32Array(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version, colorFilter, hiddenVoxels]);

  useLayoutEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
  }, [positions]);

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef} />
      {/* Nét tối rất nhạt: đọc như vệt bóng ở khe giữa các khối, không chói trên
          màu sáng như nét trắng, cũng không thành khung đen như opacity cao. */}
      <lineBasicMaterial color="#000000" transparent opacity={0.15} />
    </lineSegments>
  );
}
