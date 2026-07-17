import { useMemo } from 'react';
import * as THREE from 'three';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { useDrag } from './dragStore';
import { useInput } from './input';

interface HoverPreviewProps {
  cell: Cell | null;
}

/** Khung xem trước vị trí sắp đặt/xóa/sơn khối — chỉ hiện các cạnh thẳng. */
export function HoverPreview({ cell }: HoverPreviewProps) {
  const mode = useEditor((s) => s.mode);
  const erase = useInput((s) => s.erase);
  const pick = useInput((s) => s.pick);
  const dragging = useDrag((s) => s.drag !== null);
  // Chỉ lấy 12 cạnh của khối (không có đường chéo tam giác như wireframe).
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
    [],
  );

  if (!cell || dragging) return null;
  const [x, y, z] = cell;
  const color = pick
    ? '#b784f5'
    : erase || mode === 'remove'
      ? '#ff5470'
      : mode === 'paint'
        ? '#ffd166'
        : '#7fd6ff';

  return (
    <lineSegments position={[x + 0.5, y + 0.5, z + 0.5]} geometry={edges}>
      <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  );
}
