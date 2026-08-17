import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { regionBox, useDrag } from './dragStore';
import {
  boxEdgePoints,
  PREVIEW_COLOR,
  PREVIEW_LINE_WIDTH,
  SELECT_COLOR,
} from './previewLines';

/**
 * Hộp mờ bao vùng đang kéo. Cập nhật vị trí/kích thước IMPERATIVE trong useFrame
 * (không re-render React, không tạo lại geometry) để không giật khi di chuột.
 * Khung dùng Line2 (drei) nên nét dày theo pixel, giống khung hover 1 ô.
 */
export function RegionPreview() {
  const groupRef = useRef<THREE.Group>(null);
  const points = useMemo(() => boxEdgePoints(1), []);
  // Selector trả về string nên chỉ re-render khi đổi mode, không phải mỗi lần di chuột.
  const mode = useDrag((s) => s.drag?.mode);
  // Màu cố định, không theo màu palette: trắng mờ khi đặt/sơn, đỏ khi xóa, cam khi
  // đang quét vùng chọn (quét chọn không sửa khối nào nên phải trông khác hẳn).
  const color =
    mode === 'remove' ? '#ff5470' : mode === 'select' ? SELECT_COLOR : PREVIEW_COLOR;

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
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <Line
        points={points}
        segments
        color={color}
        lineWidth={PREVIEW_LINE_WIDTH}
        transparent
        opacity={0.95}
      />
    </group>
  );
}
