import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { beginDragGround, useDrag } from './dragStore';
import { useHoverBlock } from './hoverStore';
import { useInput } from './input';

const SIZE = 64;

interface GroundProps {
  onHover: (cell: Cell | null) => void;
}

/** Mặt sàn ở z=0 để đặt khối lớp đầu, kèm lưới canh toạ độ. */
export function Ground({ onHover }: GroundProps) {
  const mode = useEditor((s) => s.mode);
  const camera = useThree((s) => s.camera);

  // Camera ở trên sàn -> đặt lên trên (z=0); ở dưới -> đặt xuống dưới (z=-1).
  const layerZ = () => (camera.position.z >= 0 ? 0 : -1);

  const toCell = (e: ThreeEvent<PointerEvent>): Cell => [
    Math.floor(e.point.x),
    Math.floor(e.point.y),
    layerZ(),
  ];

  return (
    <group>
      {/* gridHelper nằm sẵn trong mặt XZ; xoay 90° quanh X để đưa về mặt XY của scene Z-up. */}
      <gridHelper
        args={[SIZE, SIZE, '#4a4a55', '#2f2f38']}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.001]}
      />
      <mesh
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const { rotate, pan, erase } = useInput.getState();
          if (rotate || pan) return; // nhường cho camera
          if (erase || mode !== 'place') return; // trên sàn không có gì để xóa
          e.stopPropagation();
          const [x, y, z] = toCell(e);
          beginDragGround(x, y, 'place', z);
        }}
        onPointerMove={(e) => {
          if (useDrag.getState().drag) return; // đang kéo -> khỏi tính hover
          // Tới được đây nghĩa là tia không trúng khối nào (khối gần hơn sẽ chặn sự kiện lại),
          // nên chắc chắn không còn khối nào đang được trỏ.
          useHoverBlock.getState().setBlock(null);
          if (mode !== 'place') {
            onHover(null);
            return;
          }
          onHover(toCell(e));
        }}
        onPointerOut={() => {
          onHover(null);
          useHoverBlock.getState().setBlock(null);
        }}
      >
        {/* planeGeometry nằm sẵn trong mặt XY — đúng mặt sàn của scene Z-up, khỏi xoay. */}
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
