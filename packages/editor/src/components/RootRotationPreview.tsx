import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { gameColorById, type LevelLayer, type Vec3 } from '@voxel/core';

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** Độ nhạy kéo chuột: 1 px = 0.5°. */
const DEG_PER_PX = 0.5;

/**
 * Fov hẹp (30°) chứ không phải 60° như camera game: ở đây cần thấy ĐÚNG hình dáng để căn góc, mà
 * fov rộng thì méo phối cảnh mạnh, cạnh gần phình ra cạnh xa tóp lại. Camera game thật ở
 * `(0,0,-10)` fov 60 — khung của nó chỉ vừa một phần khối, không dùng để căn góc được.
 */
const FOV = 30;

interface RootRotationPreviewProps {
  /** Layer đã dựng để xuất — toạ độ trong đây ĐÚNG bằng toạ độ trong file .asset. */
  layers: LevelLayer[];
  /** `rootLocalEulerAngles` đang đặt, theo đúng nghĩa của Unity. */
  euler: Vec3;
  onChange: (euler: Vec3) => void;
}

/**
 * Ba góc Euler của Unity -> một `THREE.Euler` cho scene three.js.
 *
 * Không thể nhét thẳng ba số vào three.js: Unity thuận trái (Z hướng vào trong), three.js thuận
 * phải (Z hướng ra ngoài), và Unity quay theo thứ tự Z→X→Y. Quy đổi bằng phép soi gương
 * M: (x,y,z) -> (x,y,−z):
 *
 *   ma trận Unity  = RY(y)·RX(x)·RZ(z)  (quay thuận trái = quay thuận phải với góc đổi dấu)
 *   M·(…)·M        = RY(+y)·RX(+x)·RZ(−z)  theo chiều thuận phải
 *
 * tức đúng bằng `THREE.Euler(x, y, −z, 'YXZ')`. Vị trí khối cũng phải soi gương theo (z đổi dấu),
 * nếu không thì hình bị lộn ngược so với game.
 *
 * Tự kiểm bằng số, với trục đứng của khối là data z (0,0,1):
 *   (90, 0, 0)  -> (0, +1.00,  0.00)  dựng thẳng, nhìn chính diện  <- góc mặc định của tool
 *   (65, 0, 45) -> (0, +0.91, −0.42)  dựng đứng, ngả ra xa 25°, xoay chéo 45°  <- các level mẫu
 *   (0, 0, 0)   -> (0,  0.00, −1.00)  nằm ngửa, trục đứng chỉ vào màn hình
 */
export function unityEulerToThree(euler: Vec3): THREE.Euler {
  const d = Math.PI / 180;
  return new THREE.Euler(euler.x * d, euler.y * d, -euler.z * d, 'YXZ');
}

/** Giữ góc trong [0, 360) cho số đọc gọn, và khớp cách Unity hiện góc trong Inspector. */
function wrap(deg: number): number {
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * Xem trước hướng khối như lúc game xếp map, để chọn `rootLocalEulerAngles`.
 *
 * Camera đứng yên và KHỐI quay — đúng như trong game (camera của scene cố định, chỉ transform gốc
 * của level mang ba góc này). Nên kéo chuột ở đây là sửa thẳng ba con số đó, không phải xoay camera.
 */
export function RootRotationPreview({ layers, euler, onChange }: RootRotationPreviewProps) {
  const items = useMemo(() => {
    const out: { pos: Vec3; hex: string }[] = [];
    for (const layer of layers) {
      const hex = gameColorById(layer.colorType)?.hex ?? '#888888';
      for (const pos of layer.voxelPositions) out.push({ pos, hex });
    }
    return out;
  }, [layers]);

  /**
   * Khoảng cách camera: đo bán kính khối QUANH GỐC QUAY rồi lùi đủ xa để cả khối luôn nằm trong
   * khung ở mọi hướng. Không đổi khi xoay — nhìn hình phình ra co lại lúc kéo thì không so được
   * góc nào đẹp hơn góc nào.
   */
  const distance = useMemo(() => {
    let r = 1;
    for (const { pos } of items) {
      r = Math.max(r, Math.hypot(pos.x, pos.y, pos.z));
    }
    // fov 30° -> nửa góc 15°: cần r / sin(15°) mới đủ chỗ, thêm chút biên.
    return ((r + 1) / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.06;
  }, [items]);

  const dragRef = useRef<{ x: number; y: number; euler: Vec3 } | null>(null);
  const eulerRef = useRef(euler);
  eulerRef.current = euler;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, euler: { ...eulerRef.current } };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = (e.clientX - start.x) * DEG_PER_PX;
    const dy = (e.clientY - start.y) * DEG_PER_PX;
    // Kéo ngang = xoay quanh trục đứng của chính khối (góc Z, vì Unity quay Z trước tiên).
    // Kéo dọc  = ngả trước/sau (góc X). Giữ Shift + kéo ngang = góc Y (xoay quanh trục đứng
    // của màn hình sau khi đã ngả) — ít dùng nên để sau phím phụ.
    if (e.shiftKey) {
      onChange({ ...start.euler, y: wrap(start.euler.y + dx) });
    } else {
      onChange({
        x: wrap(start.euler.x + dy),
        y: start.euler.y,
        z: wrap(start.euler.z + dx),
      });
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <div
      className="ex-preview-box"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="Kéo để xoay: ngang = xoay quanh trục đứng của khối, dọc = ngả trước/sau, Shift + ngang = góc Y"
    >
      {items.length === 0 ? (
        <div className="ex-preview-empty">chưa có khối nào</div>
      ) : (
        <Canvas
          // Camera nhìn dọc −Z, Y hướng lên — cùng hướng camera game (Unity `(0,0,-z)` rotation 0)
          // sau khi soi gương z, chỉ khác là lùi ra xa cho vừa cả khối.
          camera={{ position: [0, 0, distance], fov: FOV, up: [0, 1, 0] }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#15151a']} />
          <ambientLight intensity={0.8} />
          <hemisphereLight args={['#ffffff', '#c8c8d4', 0.6]} />
          <directionalLight position={[6, 10, 12]} intensity={0.6} />
          <directionalLight position={[-8, -4, -10]} intensity={0.3} />
          {/* Khối luôn quay quanh gốc của chính nó và nằm giữa khung: `rootPosition`/`objectScale`
              cố tình KHÔNG áp vào đây — chúng chỉ dịch và phóng khối trong scene game, không đổi
              hướng, mà áp vào thì khối lệch ra khỏi khung và hết căn được góc. */}
          <VoxelCloud items={items} euler={euler} />
        </Canvas>
      )}
    </div>
  );
}

/** Khối xem trước: một instancedMesh, quay bằng đúng ba góc Euler của Unity. */
function VoxelCloud({ items, euler }: { items: { pos: Vec3; hex: string }[]; euler: Vec3 }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rotation = useMemo(() => unityEulerToThree(euler), [euler]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (!mesh.instanceColor || mesh.instanceColor.count !== items.length) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(Math.max(1, items.length) * 3),
        3,
      );
    }
    items.forEach(({ pos, hex }, i) => {
      // Dùng NGUYÊN con số sẽ ghi vào file (không +0.5 như scene dựng), để khối quay quanh đúng
      // gốc mà transform gốc của level quay quanh. z đổi dấu: phần soi gương Unity -> three.js.
      tmpMatrix.setPosition(pos.x, pos.y, -pos.z);
      mesh.setMatrixAt(i, tmpMatrix);
      mesh.setColorAt(i, tmpColor.set(hex));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <group rotation={rotation}>
      <instancedMesh key={items.length} ref={meshRef} args={[undefined, undefined, items.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.75} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}
