import { useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei';
import { Voxels, type Cell } from './Voxels';
import { VoxelEdges } from './VoxelEdges';
import { Ground } from './Ground';
import { HoverPreview } from './HoverPreview';
import { RegionPreview } from './RegionPreview';
import { DragFill } from './DragFill';
import { CameraRig } from './CameraRig';
import { Hud } from './Hud';

export function EditorScene() {
  const [hover, setHover] = useState<Cell | null>(null);

  // Chỉ re-render khi ô hover thật sự đổi (tránh setState mỗi pixel di chuột).
  const setHoverDedup = useCallback((c: Cell | null) => {
    setHover((prev) => {
      if (prev === c) return prev;
      if (prev && c && prev[0] === c[0] && prev[1] === c[1] && prev[2] === c[2]) {
        return prev;
      }
      return c;
    });
  }, []);

  return (
    <div className="canvas-wrap">
      <Canvas
        camera={{ position: [16, 16, 16], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => setHoverDedup(null)}
      >
        <color attach="background" args={['#1a1a1f']} />
        {/* Sáng đều mọi hướng: ambient nền + hemisphere sáng cả trên lẫn dưới */}
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#c8c8d4', 0.7]} />
        <directionalLight position={[12, 20, 8]} intensity={0.5} />
        <directionalLight position={[-10, -14, -6]} intensity={0.35} />
        <Ground onHover={setHoverDedup} />
        <Voxels onHover={setHoverDedup} />
        <VoxelEdges />
        <HoverPreview cell={hover} />
        <RegionPreview />
        <DragFill />
        <CameraRig />
        {/* Gizmo góc màn hình: click mặt để nhìn theo trục đó */}
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport
            axisColors={['#ff5470', '#8bd450', '#4b86c9']}
            labelColor="#111"
          />
        </GizmoHelper>
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>
      <Hud hover={hover} />
    </div>
  );
}
