import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { useDrag } from './dragStore';
import { useInput } from './input';
import { boxEdgePoints, PREVIEW_COLOR, PREVIEW_LINE_WIDTH, SELECT_COLOR } from './previewLines';

interface HoverPreviewProps {
  cell: Cell | null;
}

/** Khung xem trước vị trí sắp đặt/xóa/sơn khối — chỉ hiện các cạnh thẳng. */
export function HoverPreview({ cell }: HoverPreviewProps) {
  const mode = useEditor((s) => s.mode);
  const erase = useInput((s) => s.erase);
  const pick = useInput((s) => s.pick);
  const dragging = useDrag((s) => s.drag !== null);
  const points = useMemo(() => boxEdgePoints(1.02), []);

  if (!cell || dragging) return null;
  const [x, y, z] = cell;
  const color = pick
    ? '#b784f5'
    : erase || mode === 'remove'
      ? '#ff5470'
      : mode === 'select'
        ? SELECT_COLOR
        : PREVIEW_COLOR;

  return (
    <Line
      points={points}
      segments
      color={color}
      lineWidth={PREVIEW_LINE_WIDTH}
      transparent
      opacity={0.95}
      depthTest={false}
      position={[x + 0.5, y + 0.5, z + 0.5]}
      renderOrder={10}
    />
  );
}
