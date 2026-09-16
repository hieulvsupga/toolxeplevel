import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { gameColorById, overlapsAnyWrapper } from '@voxel/core';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { useDrag } from './dragStore';
import { useInput } from './input';
import { useWrapperDrag } from './WrapperPlace';
import { boxEdgePoints, PREVIEW_COLOR, PREVIEW_LINE_WIDTH, SELECT_COLOR } from './previewLines';

interface HoverPreviewProps {
  cell: Cell | null;
}

/** Khung xem trước vị trí sắp đặt/xóa/sơn khối — chỉ hiện các cạnh thẳng. */
export function HoverPreview({ cell }: HoverPreviewProps) {
  const mode = useEditor((s) => s.mode);
  const brush = useEditor((s) => s.wrapperBrush);
  const wrappers = useEditor((s) => s.wrappers);
  const erase = useInput((s) => s.erase);
  const pick = useInput((s) => s.pick);
  const dragging = useDrag((s) => s.drag !== null);
  const dragBox = useWrapperDrag((s) => s.box);
  const points = useMemo(() => boxEdgePoints(1.02), []);

  /**
   * Chế độ đặt lớp bọc: khung xem trước to bằng CẢ HỘP sắp đặt, không phải một ô — nhìn trước được
   * cái hộp nằm ở đâu là điểm chính của kiểu đặt này. Đỏ = chỗ đó đè lên lớp bọc khác, bấm không ăn.
   */
  const box = useMemo(() => {
    if (mode !== 'wrapper') return null;
    // Đang kéo thì vẽ đúng cái hộp đang dài ra; chưa kéo thì vẽ hộp đúng cỡ ngòi ở ô đang trỏ.
    if (dragBox) {
      const size = {
        x: dragBox.max[0] - dragBox.min[0] + 1,
        y: dragBox.max[1] - dragBox.min[1] + 1,
        z: dragBox.max[2] - dragBox.min[2] + 1,
      };
      return {
        size,
        blocked: dragBox.blocked,
        center: [
          dragBox.min[0] + size.x / 2,
          dragBox.min[1] + size.y / 2,
          dragBox.min[2] + size.z / 2,
        ] as [number, number, number],
      };
    }
    if (!cell) return null;
    const size = {
      x: Math.max(1, brush.size.x),
      y: Math.max(1, brush.size.y),
      z: Math.max(1, brush.size.z),
    };
    const min = { x: cell[0], y: cell[1], z: cell[2] };
    const max = { x: min.x + size.x - 1, y: min.y + size.y - 1, z: min.z + size.z - 1 };
    return {
      size,
      blocked: overlapsAnyWrapper(wrappers, { min, max }),
      center: [min.x + size.x / 2, min.y + size.y / 2, min.z + size.z / 2] as [
        number,
        number,
        number,
      ],
    };
  }, [mode, cell, brush.size, wrappers, dragBox]);

  if (dragging) return null;
  if (box) {
    const color = box.blocked
      ? '#ff5470'
      : brush.kind === 'largeVoxel'
        ? (gameColorById(brush.color)?.hex ?? PREVIEW_COLOR)
        : '#7fd6ff';
    return (
      <group position={box.center}>
        <Line
          points={points}
          segments
          color={color}
          lineWidth={PREVIEW_LINE_WIDTH}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={10}
          scale={[box.size.x, box.size.y, box.size.z]}
        />
        <mesh scale={[box.size.x, box.size.y, box.size.z]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      </group>
    );
  }

  if (!cell) return null;
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
