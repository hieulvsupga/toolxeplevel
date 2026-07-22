import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEditor } from '../store';
import {
  extractTriangles,
  gridDims,
  loadModel,
  makeTextureSampler,
  voxelize,
  type TriData,
  type VoxelItem,
} from '../lib/modelVoxelizer';
import { loadImageData } from '../lib/imageVoxelizer';

type ModelColorMode = 'model' | 'texture' | 'single';

interface ImportModelPanelProps {
  onClose: () => void;
  initialFile?: File;
}

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();

/** Instanced mesh dựng từ danh sách voxel, canh giữa & scale vừa khung. */
function PreviewMesh({ items }: { items: VoxelItem[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const fit = useMemo(() => {
    if (!items.length) return { scale: 1, cx: 0, cy: 0, cz: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const it of items) {
      if (it.x < minX) minX = it.x;
      if (it.x > maxX) maxX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.y > maxY) maxY = it.y;
      if (it.z < minZ) minZ = it.z;
      if (it.z > maxZ) maxZ = it.z;
    }
    const sx = maxX - minX + 1, sy = maxY - minY + 1, sz = maxZ - minZ + 1;
    const scale = 12 / Math.max(sx, sy, sz);
    return { scale, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
  }, [items]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const cap = Math.max(1, items.length);
    if (!mesh.instanceColor || mesh.instanceColor.count !== cap) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      tmpMatrix.setPosition(it.x, it.y, it.z);
      mesh.setMatrixAt(i, tmpMatrix);
      tmpColor.set(it.color);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);

  return (
    <group scale={fit.scale} position={[-fit.cx * fit.scale, -fit.cy * fit.scale, -fit.cz * fit.scale]}>
      <instancedMesh ref={ref} key={items.length} args={[undefined, undefined, Math.max(1, items.length)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} metalness={0.05} />
      </instancedMesh>
    </group>
  );
}

function ModelPreview({ items }: { items: VoxelItem[] }) {
  return (
    <Canvas camera={{ position: [14, 12, 16], fov: 45 }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={['#15151a']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 20, 12]} intensity={1.2} />
      <directionalLight position={[-10, 5, -8]} intensity={0.4} />
      <PreviewMesh items={items} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
    </Canvas>
  );
}

export function ImportModelPanel({ onClose, initialFile }: ImportModelPanelProps) {
  const color = useEditor((s) => s.color);
  const stampVoxels = useEditor((s) => s.stampVoxels);

  const [tri, setTri] = useState<TriData | null>(null);
  const [fileName, setFileName] = useState('');
  const [resolution, setResolution] = useState(32);
  const [resText, setResText] = useState('32');
  const [colorMode, setColorMode] = useState<ModelColorMode>('model');
  const [texData, setTexData] = useState<ImageData | null>(null);
  const [texName, setTexName] = useState('');
  const [busy, setBusy] = useState(false);
  const [computing, setComputing] = useState(false);
  const [err, setErr] = useState('');

  const [preview, setPreview] = useState<VoxelItem[]>([]);

  const dims = useMemo(() => (tri ? gridDims(tri.box, resolution) : null), [tri, resolution]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setTri(null);
    setPreview([]);
    try {
      const obj = await loadModel(file);
      const td = extractTriangles(obj);
      if (!td.a.length) throw new Error('Model không có mặt (tam giác) nào');
      setTri(td);
      setFileName(file.name);
      if (!td.hasUV && colorMode === 'texture') setColorMode('model');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialFile) readFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // Voxel hóa LẠI (debounce) khi đổi độ phân giải / màu / texture -> xem trước 3D.
  useEffect(() => {
    if (!tri) {
      setPreview([]);
      return;
    }
    setComputing(true);
    const opts =
      colorMode === 'single'
        ? { overrideColor: color }
        : colorMode === 'texture' && texData
          ? { sampler: makeTextureSampler(texData) }
          : {};
    const timer = setTimeout(() => {
      try {
        setPreview(voxelize(tri, resolution, opts));
        setErr('');
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setComputing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tri, resolution, colorMode, texData, color]);

  const clampRes = (v: number) => Math.max(4, Math.min(96, Math.round(v) || 4));

  const readTexture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await loadImageData(file);
      setTexData(data);
      setTexName(file.name);
      setColorMode('texture');
    } catch (e) {
      setErr('Không đọc được texture: ' + (e as Error).message);
    }
  };

  const handleCreate = () => {
    if (!preview.length) return;
    stampVoxels(preview);
    onClose();
  };

  const size = tri ? tri.box.getSize(new THREE.Vector3()) : null;

  return createPortal(
    <div className="import-screen">
      <div className="import-topbar">
        <span className="import-heading">🧊 Import model 3D → khối</span>

        <label className="file-btn">
          {tri ? 'Chọn model khác' : 'Chọn model…'}
          <input
            type="file"
            accept=".fbx,.glb,.gltf,.obj,.stl"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              readFile(f);
            }}
          />
        </label>

        {tri && dims && (
          <>
            <div className="import-ctrl">
              <label>Độ phân giải</label>
              <input
                type="number"
                min={4}
                max={96}
                value={resText}
                onChange={(e) => {
                  const t = e.target.value;
                  setResText(t);
                  const n = Number(t);
                  if (t !== '' && Number.isFinite(n) && n >= 4) setResolution(Math.min(96, n));
                }}
                onBlur={() => {
                  const n = clampRes(Number(resText));
                  setResolution(n);
                  setResText(String(n));
                }}
              />
            </div>

            <div className="seg">
              <button
                className={colorMode === 'model' ? 'active' : ''}
                onClick={() => setColorMode('model')}
                title="Lấy màu vật liệu của model"
              >
                Màu model
              </button>
              <button
                className={colorMode === 'texture' ? 'active' : ''}
                onClick={() => texData && setColorMode('texture')}
                disabled={!texData || !tri.hasUV}
                title={
                  !tri.hasUV
                    ? 'Model không có UV nên không map được texture'
                    : !texData
                      ? 'Chọn ảnh texture trước'
                      : 'Lấy màu từ texture theo UV'
                }
              >
                Texture
              </button>
              <button
                className={colorMode === 'single' ? 'active' : ''}
                onClick={() => setColorMode('single')}
                title="Dùng màu đang chọn cho tất cả khối"
              >
                <span
                  style={{ background: color, display: 'inline-block', width: 12, height: 12, verticalAlign: 'middle' }}
                />{' '}
                1 màu
              </button>
            </div>

            <label className="file-btn">
              {texName ? '🖼 Texture khác' : '🖼 Chọn texture…'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  readTexture(f);
                }}
              />
            </label>

            <span className="modal-dim">
              lưới {dims.nx}×{dims.ny}×{dims.nz}
              {computing ? ' · đang tính…' : ` · ${preview.length} khối`}
              {tri.hasUV ? '' : ' · (không UV)'}
            </span>
          </>
        )}

        {err && <span className="modal-err">{err}</span>}

        <div className="import-spacer" />

        {tri && (
          <button
            className="primary create-btn"
            onClick={handleCreate}
            disabled={busy || computing || !preview.length}
          >
            Tạo {preview.length} khối
          </button>
        )}
        <button className="create-btn" onClick={onClose}>
          Đóng
        </button>
      </div>

      <div className="import-stage">
        {tri ? (
          <div className="model-preview">
            <ModelPreview items={preview} />
            <div className="model-preview-hint">
              {fileName} · {size!.x.toFixed(1)}×{size!.y.toFixed(1)}×{size!.z.toFixed(1)} · kéo
              chuột để xoay
            </div>
          </div>
        ) : (
          <label className="dropzone">
            <div className="dropzone-big">{busy ? 'Đang nạp model…' : '＋ Bấm để chọn model 3D'}</div>
            <div className="dropzone-sub">
              Hỗ trợ .fbx .glb .gltf .obj .stl — tool sẽ lấp các cube vào bên trong khối
              (solid voxelization).
            </div>
            <input
              type="file"
              accept=".fbx,.glb,.gltf,.obj,.stl"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                readFile(f);
              }}
            />
          </label>
        )}
      </div>
    </div>,
    document.body,
  );
}
