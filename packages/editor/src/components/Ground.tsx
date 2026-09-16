import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useEditor } from '../store';
import type { Cell } from './Voxels';
import { AXIS_X_DIM, AXIS_Y_DIM } from './axisColors';
import { beginDragGround, useDrag } from './dragStore';
import { useHoverBlock } from './hoverStore';
import { useInput } from './input';

const SIZE = 64;
const HALF = SIZE / 2;

// Màu các ô lưới sàn. Hai đường trục chính không dùng màu này nữa mà lấy màu trục
// (đỏ/xanh lá) giống gizmo, nên gridHelper tô đều một màu cho mọi đường.
const GRID_LINE_COLOR_DIM = '#2f2f38';

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
        args={[SIZE, SIZE, GRID_LINE_COLOR_DIM, GRID_LINE_COLOR_DIM]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0.001]}
      />
      {/* Trục X đỏ, trục Y xanh lá — cùng màu với gizmo góc màn hình và marker gốc
          toạ độ, để nhìn sàn là biết ngay đang ở hướng nào. Nhích lên trên lưới
          một chút cho khỏi z-fight với đường lưới đi qua gốc. */}
      <Line
        points={[
          [-HALF, 0, 0.002],
          [HALF, 0, 0.002],
        ]}
        color={AXIS_X_DIM}
        lineWidth={2}
      />
      <Line
        points={[
          [0, -HALF, 0.002],
          [0, HALF, 0.002],
        ]}
        color={AXIS_Y_DIM}
        lineWidth={2}
      />
      <mesh
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const { rotate, pan, erase } = useInput.getState();
          if (rotate || pan) return; // nhường cho camera
          // Trên sàn không có gì để xóa/sơn; chỉ đặt khối hoặc quét vùng chọn.
          if (erase || (mode !== 'place' && mode !== 'select')) return;
          e.stopPropagation();
          const [x, y, z] = toCell(e);
          beginDragGround(x, y, mode, z);
        }}
        onPointerMove={(e) => {
          if (useDrag.getState().drag) return; // đang kéo -> khỏi tính hover
          // Tới được đây nghĩa là tia không trúng khối nào (khối gần hơn sẽ chặn sự kiện lại),
          // nên chắc chắn không còn khối nào đang được trỏ.
          useHoverBlock.getState().setBlock(null);
          // Chế độ đặt lớp bọc cũng cần ô đích trên sàn (đặt khối lớn xuống chỗ trống).
          if (mode !== 'place' && mode !== 'select' && mode !== 'wrapper') {
            onHover(null);
            return;
          }
          onHover(toCell(e));
          // Sàn: mặt ngửa lên (hoặc úp xuống khi camera ở dưới sàn) — xem `layerZ`.
          useHoverBlock.getState().setTargetNormal([0, 0, layerZ() === 0 ? 1 : -1]);
        }}
        onPointerOut={() => {
          onHover(null);
          useHoverBlock.getState().setBlock(null);
          useHoverBlock.getState().setTargetNormal(null);
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
