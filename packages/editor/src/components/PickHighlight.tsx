import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SELECT_COLOR } from './previewLines';
import { livePickCells, useSelection } from './selectionStore';
import { useEditor } from '../store';

const tmpMatrix = new THREE.Matrix4();

/**
 * Tô sáng từng khối của vùng chọn 2D.
 *
 * Vùng chọn 2D rời rạc nên chỉ vẽ khung hộp bao là nói sai: hộp bao có thể to gấp mấy lần phần thật
 * được chọn. Phải thấy đúng những khối nào đang được chọn.
 */
export function PickHighlight() {
  const pick = useSelection((s) => s.pick);
  const version = useEditor((s) => s.version);
  const hiddenTick = useSelection((s) => s.pick?.cells.length ?? 0);

  const cells = useMemo(
    () => (pick ? livePickCells(pick) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, version, hiddenTick],
  );

  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < cells.length; i++) {
      const [x, y, z] = cells[i];
      tmpMatrix.setPosition(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [cells]);

  if (!cells.length) return null;

  return (
    <instancedMesh
      ref={ref}
      key={cells.length}
      args={[undefined, undefined, cells.length]}
      renderOrder={12}
    >
      {/* Nhô ra một chút để không trùng mặt khối (trùng thì nhấp nháy). */}
      <boxGeometry args={[1.06, 1.06, 1.06]} />
      <meshBasicMaterial
        color={SELECT_COLOR}
        transparent
        opacity={0.32}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
