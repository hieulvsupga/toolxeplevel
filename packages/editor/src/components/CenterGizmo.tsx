import { useMemo } from 'react';
import { recenterOffset } from '@voxel/core';
import { useEditor } from '../store';

/**
 * Marker gốc toạ độ ("center"): điểm mà file .asset coi là (0,0,0).
 * Vị trí = `recenterOffset` (tâm hộp bao tự động, hoặc tâm đặt tay). Trục đứng là Z.
 * Vẽ luôn hiện xuyên khối (depthTest tắt) để không bị che.
 */
export function CenterGizmo() {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const recenter = useEditor((s) => s.recenter);
  const centerOverride = useEditor((s) => s.centerOverride);
  const show = useEditor((s) => s.showCenter);

  const off = useMemo(
    () => recenterOffset(grid, recenter, centerOverride),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version, recenter, centerOverride],
  );

  if (!show) return null;

  const L = 3.2; // nửa chiều dài mỗi trục (dài gần như cũ)
  const t = 0.05; // độ dày trục (mảnh)
  const axis = (args: [number, number, number], color: string) => (
    <mesh renderOrder={999}>
      <boxGeometry args={args} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  );
  return (
    <group position={[off.x, off.y, off.z]}>
      {/* chấm tâm nhỏ */}
      <mesh renderOrder={1000}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
      </mesh>
      {axis([2 * L, t, t], '#ff5470')}
      {axis([t, 2 * L, t], '#8bd450')}
      {axis([t, t, 2 * L], '#4b86c9')}
    </group>
  );
}
