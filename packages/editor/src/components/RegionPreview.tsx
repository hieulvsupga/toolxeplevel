import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useEditor } from '../store';
import { regionBox, useDrag } from './dragStore';

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Hộp mờ bao vùng đang kéo. Cập nhật vị trí/kích thước IMPERATIVE trong useFrame
 * (không re-render React, không tạo lại geometry) để không giật khi di chuột.
 */
export function RegionPreview() {
  const groupRef = useRef<THREE.Group>(null);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null);
  const lineMat = useRef<THREE.LineBasicMaterial>(null);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const d = useDrag.getState().drag;
    if (!d) {
      if (g.visible) g.visible = false;
      return;
    }
    g.visible = true;
    const { center, size } = regionBox(d);
    g.position.set(center[0], center[1], center[2]);
    g.scale.set(size[0], size[1], size[2]);
    const isRemove = d.mode === 'remove';
    fillMat.current?.color.set(isRemove ? '#ff5470' : useEditor.getState().color);
    lineMat.current?.color.set(isRemove ? '#ff5470' : '#7fd6ff');
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={fillMat} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[UNIT_BOX]} />
        <lineBasicMaterial ref={lineMat} />
      </lineSegments>
    </group>
  );
}
