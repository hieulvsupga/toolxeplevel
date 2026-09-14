import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  DEFAULT_MERGE_BELOW,
  GAME_COLORS,
  MAX_MAPPED_COLORS,
  WALL_COLOR_ID,
  countColors,
  gameColorByHex,
  mapColorsToGamePalette,
} from '@voxel/core';
import { useEditor } from '../store';
import { PaletteSwatches } from './PaletteSwatches';
import { yUpToEditorAll } from '../lib/axis';
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

/**
 * Cách quy màu nguồn về bảng màu game.
 *
 * `distinct` là mặc định: level cuối cùng chỉ có 16 ColorType, nên màu nào cũng phải quy về đó —
 * để nguyên màu gốc thì việc quy đổi vẫn xảy ra, chỉ là lúc XUẤT, mỗi màu tự dò màu gần nhất và
 * hai màu khác nhau lặng lẽ nhập thành một. Quy sẵn ở đây thì thấy trước được, và tách được màu.
 */
type PaletteMode = 'distinct' | 'nearest' | 'raw';

const PALETTE_MODES: { id: PaletteMode; label: string; hint: string }[] = [
  {
    id: 'distinct',
    label: '🎯 Tách màu',
    hint: 'Quy về bảng màu game, mỗi màu nguồn chiếm một màu game RIÊNG: hai màu cùng gần một màu game thì màu thứ hai lấy màu trống gần nó nhất, thay vì cả hai nhập thành một.',
  },
  {
    id: 'nearest',
    label: 'Gần nhất',
    hint: 'Quy về bảng màu game theo kiểu cũ: mỗi màu nguồn lấy màu gần nhất, chấp nhận nhiều màu nguồn về cùng một màu game.',
  },
  {
    id: 'raw',
    label: 'Màu gốc',
    hint: 'Giữ nguyên hex của model/texture. Khối vào tool đúng màu gốc, nhưng lúc xuất .asset vẫn bị dò về màu gần nhất (và có thể gộp màu).',
  },
];

/** Các màu game gán được cho khối (bỏ ô tường — tường là cơ chế, không phải màu). */
const TARGET_COLORS = GAME_COLORS.filter((c) => c.id !== WALL_COLOR_ID);

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
    <Canvas
      camera={{ position: [16, -16, 13], fov: 45, up: [0, 0, 1] }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#15151a']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 12, 20]} intensity={1.2} />
      <directionalLight position={[-10, -8, 5]} intensity={0.4} />
      <PreviewMesh items={items} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
    </Canvas>
  );
}

export function ImportModelPanel({ onClose, initialFile }: ImportModelPanelProps) {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
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

  /** Khối vừa voxel hoá, còn nguyên màu của model/texture. */
  const [rawItems, setRawItems] = useState<VoxelItem[]>([]);
  /** Tô màu theo mặt model (lấy màu theo phiếu trên cả diện tích khối) — xem `paintSurfaceColors`. */
  const [surfaceColors, setSurfaceColors] = useState(true);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('distinct');
  const [maxColors, setMaxColors] = useState(MAX_MAPPED_COLORS);
  const [mergeBelow, setMergeBelow] = useState(DEFAULT_MERGE_BELOW);
  /** Màu ép tay: hex nguồn tiêu biểu của nhóm -> ColorType. */
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // Bảng gán màu. Tính từ SỐ VOXEL từng màu (không phải từ số pixel của texture): màu phủ nhiều
  // khối mới là màu quyết định hình trông thế nào, còn một màu chỉ dính 2 voxel thì không đáng
  // giành một ô trong bảng màu 16 màu.
  const mapping = useMemo(() => {
    if (paletteMode === 'raw' || !rawItems.length) return null;
    return mapColorsToGamePalette(countColors(rawItems), {
      distinct: paletteMode === 'distinct',
      maxColors,
      mergeBelow,
      overrides,
    });
  }, [rawItems, paletteMode, maxColors, mergeBelow, overrides]);

  /** Khối sẽ được tạo thật — đã quy màu. Xem trước 3D cũng dùng đúng cái này. */
  const preview = useMemo(() => {
    if (!mapping) return rawItems;
    return rawItems.map((it) => ({
      ...it,
      color: mapping.map.get(it.color.toUpperCase()) ?? it.color,
    }));
  }, [rawItems, mapping]);

  const dims = useMemo(() => (tri ? gridDims(tri.box, resolution) : null), [tri, resolution]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    setTri(null);
    setRawItems([]);
    try {
      const obj = await loadModel(file);
      const td = extractTriangles(obj);
      if (!td.a.length) throw new Error('Model không có mặt (tam giác) nào');
      setTri(td);
      setFileName(file.name);
      // Model khác thì bảng gán màu cũ chẳng còn nhóm nào để ép.
      setOverrides({});
      if (!td.hasUV && colorMode === 'texture') setColorMode('model');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Đổi nguồn màu (chế độ màu, hay texture khác) là bảng nhóm khác hẳn -> bỏ hết màu ép tay, không
  // thì mấy hex ép cũ nằm lại và lặng lẽ áp cho nhóm trùng hex ở bảng mới.
  useEffect(() => {
    setOverrides({});
  }, [colorMode, texData]);

  useEffect(() => {
    if (initialFile) readFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // Voxel hóa LẠI (debounce) khi đổi độ phân giải / màu / texture -> xem trước 3D.
  useEffect(() => {
    if (!tri) {
      setRawItems([]);
      return;
    }
    setComputing(true);
    const opts =
      colorMode === 'single'
        ? { overrideColor: color }
        : colorMode === 'texture' && texData
          ? {
              sampler: makeTextureSampler(texData),
              surfaceColors,
              textureSize: { width: texData.width, height: texData.height },
            }
          : { surfaceColors };
    const timer = setTimeout(() => {
      try {
        // Quy về hệ trục editor ngay tại đây, để phần xem trước hiện đúng thứ sẽ được tạo ra.
        setRawItems(yUpToEditorAll(voxelize(tri, resolution, opts)));
        setErr('');
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setComputing(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tri, resolution, colorMode, texData, color, surfaceColors]);

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
            {/* Độ phân giải */}
            <div className="tb-group">
              <span className="tb-glabel">Độ phân giải</span>
              <input
                className="num"
                type="number"
                min={4}
                max={96}
                title="Số ô theo cạnh dài nhất"
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
              <span className="tb-x">
                {dims.nx}×{dims.ny}×{dims.nz}
              </span>
            </div>

            {/* Màu */}
            <div className="tb-group">
              <span className="tb-glabel">Màu</span>
              <div className="seg">
                <button
                  className={colorMode === 'model' ? 'active' : ''}
                  onClick={() => setColorMode('model')}
                  title="Lấy màu vật liệu của model"
                >
                  Màu model
                </button>
                {texData && (
                  <button
                    className={colorMode === 'texture' ? 'active' : ''}
                    onClick={() => setColorMode('texture')}
                    title="Lấy màu từ texture theo UV"
                  >
                    🖼 Texture
                  </button>
                )}
                <button
                  className={colorMode === 'single' ? 'active' : ''}
                  onClick={() => setColorMode('single')}
                  title="Dùng 1 màu cho tất cả khối"
                >
                  <span
                    style={{ background: color, display: 'inline-block', width: 12, height: 12, borderRadius: 3, verticalAlign: 'middle' }}
                  />{' '}
                  1 màu
                </button>
              </div>

              {tri.hasUV ? (
                <label className="file-btn small">
                  {texName ? '🖼 Đổi texture' : '🖼 + Texture'}
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
              ) : (
                <span className="tb-glabel" title="Model không có UV nên không map được texture">
                  không có UV
                </span>
              )}

              {colorMode !== 'single' && (
                <button
                  className={surfaceColors ? 'active' : ''}
                  onClick={() => setSurfaceColors((v) => !v)}
                  title={
                    'Lấy màu theo MẶT model: rải mẫu khắp bề mặt, mỗi khối lấy màu chiếm phần lớn diện tích của nó. ' +
                    'Tắt là về cách cũ — mỗi khối lấy đúng 1 pixel texture tại chỗ tia cắt mặt, nên độ phân giải thấp ' +
                    'hay ra màu của một pixel lẻ, và sườn khối (mặt đứng) thường sai màu.'
                  }
                >
                  🎯 Màu theo mặt
                </button>
              )}

              {colorMode === 'single' && (
                <div className="swatches">
                  <PaletteSwatches />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    title="Chọn màu tuỳ ý"
                  />
                </div>
              )}
            </div>

            {/* Quy màu về bảng màu game. Đặt riêng một nhóm vì nó là bước sau của "Màu": lấy màu ở
                đâu là một chuyện, quy nó về 16 ColorType của game là chuyện khác. */}
            <div className="tb-group">
              <span className="tb-glabel">Bảng màu game</span>
              <div className="seg">
                {PALETTE_MODES.map((m) => (
                  <button
                    key={m.id}
                    className={paletteMode === m.id ? 'active' : ''}
                    onClick={() => setPaletteMode(m.id)}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {paletteMode === 'distinct' && (
                <>
                  <span className="tb-glabel">tối đa</span>
                  <input
                    className="num"
                    type="number"
                    min={1}
                    max={MAX_MAPPED_COLORS}
                    title={`Số màu game tối đa được dùng (1–${MAX_MAPPED_COLORS}). Nhiều màu nguồn hơn thế thì gom cụm lại, không cắt bớt.`}
                    value={maxColors}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1) {
                        setMaxColors(Math.min(MAX_MAPPED_COLORS, Math.floor(n)));
                      }
                    }}
                  />
                  <span className="tb-glabel">gộp dưới ΔE</span>
                  <input
                    className="num"
                    type="number"
                    min={0}
                    max={40}
                    title="Hai màu nguồn cách nhau dưới mức này thì coi là một màu và gộp lại. Để 0 là tách hết — texture nén có mấy hex lệch 1–2 độ, tách ra là hình rằn ri."
                    value={mergeBelow}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setMergeBelow(Math.min(40, Math.floor(n)));
                    }}
                  />
                </>
              )}
            </div>

            <span className="modal-dim">
              {computing ? 'đang tính…' : `≈ ${preview.length} khối`}
              {mapping ? ` · ${mapping.groups.length} màu` : ''}
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
          <>
            <div className="model-preview">
              <ModelPreview items={preview} />
              <div className="model-preview-hint">
                {fileName} · {size!.x.toFixed(1)}×{size!.y.toFixed(1)}×{size!.z.toFixed(1)} · kéo
                chuột để xoay
              </div>
            </div>
            {mapping && mapping.groups.length > 0 && (
              // Bảng gán màu: thấy được màu nguồn nào thành màu game nào, và ép lại được. Không có
              // bảng này thì "màu nhìn không giống" chỉ còn cách đoán, vì phép quy đổi nằm hết
              // trong lúc xuất file.
              <div className="model-colors">
                <div className="model-colors-head">
                  <b>Gán màu</b>
                  <span className="modal-dim">
                    {mapping.groups.length} màu · trống {mapping.free.length}
                  </span>
                </div>
                <div className="model-colors-list">
                  {mapping.groups.map((g) => {
                    const src = gameColorByHex(g.source);
                    return (
                      <div className="model-color-row" key={g.source}>
                        <span
                          className="pal-swatch"
                          style={{ background: g.source }}
                          title={`Màu nguồn ${g.source}${
                            src ? ` (trùng khít ${src.name})` : ''
                          }${g.sources.length > 1 ? ` · gộp ${g.sources.length} màu nguồn` : ''}`}
                        />
                        <span className="model-color-arrow">→</span>
                        <span className="pal-swatch" style={{ background: g.target.hex }} />
                        <select
                          value={g.target.id}
                          title="Ép nhóm này về một màu game khác — màu đang bị nhóm khác giữ thì hai nhóm đổi chỗ cho nhau"
                          onChange={(e) =>
                            setOverrides((o) => ({ ...o, [g.source]: Number(e.target.value) }))
                          }
                        >
                          {TARGET_COLORS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {mapping.groups.some(
                                (other) => other.target.id === t.id && other.source !== g.source,
                              )
                                ? ' (đang dùng)'
                                : ''}
                            </option>
                          ))}
                        </select>
                        <span className="model-color-count">{g.count}</span>
                        {g.moved && (
                          <span
                            className="model-color-moved"
                            title="Màu game gần nhóm này nhất đã có nhóm khác giữ, nên nhóm này lấy màu trống gần nó nhất — đây chính là chỗ giữ cho hai màu không nhập thành một."
                          >
                            ⇄
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {Object.keys(overrides).length > 0 && (
                  <button className="link-btn" onClick={() => setOverrides({})}>
                    bỏ {Object.keys(overrides).length} màu ép tay
                  </button>
                )}
              </div>
            )}
          </>
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
