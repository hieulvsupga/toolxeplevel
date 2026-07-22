import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useEditor } from '../store';

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

/** Viền đen ở cạnh mỗi khối để phân biệt rõ các cube cạnh nhau. */
export function VoxelEdges() {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const colorFilter = useEditor((s) => s.colorFilter);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const positions = useMemo(() => {
    const keep = colorFilter.length ? new Set(colorFilter) : null;
    const pts: number[] = [];
    for (const { x, y, z, voxel } of grid.entries()) {
      if (keep && !keep.has(voxel.color)) continue; // ẩn viền của khối bị lọc
      for (const [ax, ay, az, bx, by, bz] of EDGES) {
        pts.push(x + ax, y + ay, z + az, x + bx, y + by, z + bz);
      }
    }
    return new Float32Array(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version, colorFilter]);

  useLayoutEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
  }, [positions]);

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geomRef} />
      <lineBasicMaterial color="#0b0b0e" transparent opacity={0.4} />
    </lineSegments>
  );
}
