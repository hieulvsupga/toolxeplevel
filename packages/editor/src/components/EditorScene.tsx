import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Voxels, type Cell } from './Voxels';
import { AXIS_X, AXIS_Y, AXIS_Z } from './axisColors';
import { SelectionBox } from './SelectionBox';
import { Marquee2D } from './Marquee2D';
import { MarqueeOverlay } from './MarqueeOverlay';
import { PickHighlight } from './PickHighlight';
import { WrapperBoxes } from './WrapperBoxes';
import { WrapperPlace } from './WrapperPlace';
import { VoxelEdges } from './VoxelEdges';
import { Ground } from './Ground';
import { HoverPreview } from './HoverPreview';
import { RegionPreview } from './RegionPreview';
import { DragFill } from './DragFill';
import { CameraRig } from './CameraRig';
import { CenterGizmo } from './CenterGizmo';
import { useHoverBlock } from './hoverStore';
import { useEditor } from '../store';

export function EditorScene() {
  const [hover, setHover] = useState<Cell | null>(null);
  const mode = useEditor((s) => s.mode);

  // Chỉ re-render khi ô hover thật sự đổi (tránh setState mỗi pixel di chuột).
  const setHoverDedup = useCallback((c: Cell | null) => {
    // Ô đích cũng đẩy ra store để phần dán cụm khối (SelectionPanel) đọc được.
    useHoverBlock.getState().setTarget(c);
    setHover((prev) => {
      if (prev === c) return prev;
      if (prev && c && prev[0] === c[0] && prev[1] === c[1] && prev[2] === c[2]) {
        return prev;
      }
      return c;
    });
  }, []);

  return (
    // Con trỏ chữ thập ở chế độ chọn 2D: chuột trái ở đây là kéo khung, không phải xoay camera —
    // đổi con trỏ là cách nói điều đó mà không cần đọc gợi ý.
    <div className={`canvas-wrap${mode === 'select2d' || mode === 'wrapper' ? ' picking' : ''}`}>
      <Canvas
        // Scene dựng theo Z-up để trùng hệ trục của LevelData: toạ độ một khối trong editor chính
        // là toạ độ trong file .asset, không phải quy đổi ở đâu cả. OrbitControls đọc camera.up
        // nên phải đặt ngay lúc tạo Canvas, trước khi controls khởi tạo.
        camera={{ position: [18, -18, 14], fov: 45, up: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => {
          setHoverDedup(null);
          useHoverBlock.getState().setBlock(null);
        }}
      >
        <color attach="background" args={['#1a1a1f']} />
        {/* Sáng đều mọi hướng: ambient nền + hemisphere sáng cả trên lẫn dưới */}
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#c8c8d4', 0.7]} />
        <directionalLight position={[12, 8, 20]} intensity={0.5} />
        <directionalLight position={[-10, -6, -14]} intensity={0.35} />
        <Ground onHover={setHoverDedup} />
        <Voxels onHover={setHoverDedup} />
        <VoxelEdges />
        <HoverPreview cell={hover} />
        <RegionPreview />
        <SelectionBox />
        <PickHighlight />
        <WrapperBoxes onHover={setHoverDedup} />
        <WrapperPlace />
        <DragFill />
        <Marquee2D />
        <CenterGizmo />
        <CameraRig />
        {/* Gizmo góc màn hình: click mặt để nhìn theo trục đó */}
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport
            axisColors={[AXIS_X, AXIS_Y, AXIS_Z]}
            labelColor="#111"
          />
        </GizmoHelper>
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>
      {/* Khung chọn 2D nằm NGOÀI Canvas: nó là một hình chữ nhật trên màn hình, không phải vật thể
          trong scene — vẽ trong scene thì nó xoay theo camera. */}
      <MarqueeOverlay />
    </div>
  );
}
