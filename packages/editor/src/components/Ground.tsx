import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { beginDragGround, useDrag } from './dragStore';
import { useInput } from './input';

const SIZE = 64;

interface GroundProps {
  onHover: (cell: Cell | null) => void;
}

/** Mặt sàn ở y=0 để đặt khối lớp đầu, kèm lưới canh toạ độ. */
export function Ground({ onHover }: GroundProps) {
  const mode = useEditor((s) => s.mode);
  const camera = useThree((s) => s.camera);

  // Camera ở trên sàn -> đặt lên trên (y=0); ở dưới -> đặt xuống dưới (y=-1).
  const layerY = () => (camera.position.y >= 0 ? 0 : -1);

  const toCell = (e: ThreeEvent<PointerEvent>): Cell => [
    Math.floor(e.point.x),
    layerY(),
    Math.floor(e.point.z),
  ];

  return (
    <group>
      <gridHelper args={[SIZE, SIZE, '#4a4a55', '#2f2f38']} position={[0, 0.001, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const { rotate, pan, erase } = useInput.getState();
          if (rotate || pan) return; // nhường cho camera
          if (erase || mode !== 'place') return; // trên sàn không có gì để xóa
          e.stopPropagation();
          const [x, y, z] = toCell(e);
          beginDragGround(x, z, 'place', y);
        }}
        onPointerMove={(e) => {
          if (useDrag.getState().drag) return; // đang kéo -> khỏi tính hover
          if (mode !== 'place') {
            onHover(null);
            return;
          }
          onHover(toCell(e));
        }}
        onPointerOut={() => onHover(null)}
      >
        <planeGeometry args={[SIZE, SIZE]} />
        {/* Trong suốt (vẫn ghi depth) để nhìn xuyên xuống dưới, vẫn raycast được */}
        <meshBasicMaterial
          color="#2c2c36"
          transparent
          opacity={0.1}
          depthWrite
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
