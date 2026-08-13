import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEditor } from '../store';

interface LayerPaintPanelProps {
  onClose: () => void;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const _c = new THREE.Color();
const _bg = new THREE.Color('#16161c');
/** Làm mờ màu (trộn về nền) cho các tầng KHÔNG phải tầng đang sửa. */
function dimHex(hex: string): string {
  try {
    _c.set(hex).lerp(_bg, 0.72);
    return '#' + _c.getHexString();
  } catch {
    return hex;
  }
}

interface Item {
  x: number;
  y: number;
  z: number;
  color: string;
}

function PreviewMesh({ items }: { items: Item[] }) {
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
    return { scale: 12 / Math.max(sx, sy, sz), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
  }, [items]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const cap = Math.max(1, items.length);
    if (!mesh.instanceColor || mesh.instanceColor.count !== cap) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    }
    for (let i = 0; i < items.length; i++) {
      tmpMatrix.setPosition(items[i].x, items[i].y, items[i].z);
      mesh.setMatrixAt(i, tmpMatrix);
      tmpColor.set(items[i].color);
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

export function LayerPaintPanel({ onClose }: LayerPaintPanelProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const palette = useEditor((s) => s.palette);
  const recolorCells = useEditor((s) => s.recolorCells);
  const deleteCells = useEditor((s) => s.deleteCells);
  const stampVoxels = useEditor((s) => s.stampVoxels);

  // Bao đóng X/Y + dải Z + số khối mỗi tầng (trục đứng là z).
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const perLayer = new Map<number, number>();
    for (const { x, y, z } of grid.entries()) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      perLayer.set(z, (perLayer.get(z) ?? 0) + 1);
    }
    const valid = maxZ >= minZ;
    let mostZ = minZ;
    let most = -1;
    for (const [z, n] of perLayer) if (n > most) { most = n; mostZ = z; }
    return { minX, maxX, minY, maxY, minZ, maxZ, perLayer, valid, mostZ };
  }, [grid, version]);

  const [layer, setLayer] = useState<number | null>(null);
  useEffect(() => {
    if (layer == null && bounds.valid) setLayer(bounds.mostZ);
  }, [layer, bounds]);
  const curZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, layer ?? bounds.mostZ));

  const gridRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const anchorRef = useRef<[number, number, number] | null>(null);
  const [paintMode, setPaintMode] = useState<'brush' | 'rect'>('brush');
  const [tool, setTool] = useState<'paint' | 'add' | 'erase'>('paint');
  const strokeToolRef = useRef(tool);
  // Nét đang vẽ: key ô -> màu (chuỗi) hoặc null (xóa). Overlay xem trước, commit khi thả.
  const [pending, setPending] = useState<Map<string, string | null>>(new Map());

  const cols = bounds.valid ? bounds.maxX - bounds.minX + 1 : 0;
  const rows = bounds.valid ? bounds.maxY - bounds.minY + 1 : 0;

  // Vẽ lưới 2D của tầng hiện tại.
  useEffect(() => {
    const cv = gridRef.current;
    if (!cv || !bounds.valid) return;
    const px = 18;
    cv.width = cols * px;
    cv.height = rows * px;
    const ctx = cv.getContext('2d')!;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = bounds.minX + c;
        const y = bounds.minY + r;
        const k = key(x, y, curZ);
        const pv = pending.get(k); // string = đặt màu, null = xóa, undefined = giữ nguyên
        const col = pv !== undefined ? pv : (grid.get(x, y, curZ)?.color ?? null);
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(c * px, r * px, px, px);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.strokeRect(c * px + 0.5, r * px + 0.5, px - 1, px - 1);
        } else {
          ctx.fillStyle = (r + c) % 2 ? '#20202a' : '#191921';
          ctx.fillRect(c * px, r * px, px, px);
        }
      }
    }
  }, [grid, version, curZ, pending, bounds, cols, rows]);

  // Dữ liệu 3D: cả scene, đè màu pending, làm mờ tầng khác.
  const previewItems = useMemo(() => {
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const { x, y, z, voxel } of grid.entries()) {
      const k = key(x, y, z);
      seen.add(k);
      const pv = pending.get(k);
      if (pv === null) continue; // xem trước: đã xóa
      let col = pv !== undefined ? pv : voxel.color;
      if (z !== curZ) col = dimHex(col);
      items.push({ x, y, z, color: col });
    }
    // Khối mới thêm (add) chưa có trong grid.
    for (const [k, val] of pending) {
      if (val === null || seen.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number);
      items.push({ x, y, z, color: z !== curZ ? dimHex(val) : val });
    }
    return items;
  }, [grid, version, pending, curZ]);

  const commit = () => {
    setPending((prev) => {
      if (!prev.size) return prev;
      const t = strokeToolRef.current;
      if (t === 'erase') {
        const cells = [...prev.keys()].map((k) => k.split(',').map(Number) as [number, number, number]);
        deleteCells(cells);
      } else if (t === 'add') {
        const items = [...prev.entries()].map(([k, col]) => {
          const [x, y, z] = k.split(',').map(Number);
          return { x, y, z, color: col as string };
        });
        stampVoxels(items);
      } else {
        // paint: gộp theo màu
        const byColor = new Map<string, [number, number, number][]>();
        for (const [k, col] of prev) {
          if (col == null) continue;
          const [x, y, z] = k.split(',').map(Number);
          const arr = byColor.get(col) ?? [];
          arr.push([x, y, z]);
          byColor.set(col, arr);
        }
        for (const [col, cells] of byColor) recolorCells(cells, col);
      }
      return new Map();
    });
  };

  const cellFromEvent = (e: React.PointerEvent): [number, number, number] | null => {
    const cv = gridRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return [bounds.minX + c, bounds.minY + r, curZ];
  };

  // Giá trị chỉnh cho 1 ô theo công cụ: [key, màu|null] hoặc null nếu ô không hợp lệ.
  const editFor = (x: number, y: number): [string, string | null] | null => {
    const exists = !!grid.get(x, y, curZ);
    const k = key(x, y, curZ);
    if (tool === 'erase') return exists ? [k, null] : null;
    if (tool === 'paint') return exists ? [k, color] : null;
    return [k, color]; // add: mọi ô trong lưới
  };

  // Tô lẻ: thêm ô đang trỏ vào nét.
  const brushAt = (e: React.PointerEvent) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    const edit = editFor(cell[0], cell[1]);
    if (!edit) return;
    setPending((prev) => {
      if (prev.has(edit[0]) && prev.get(edit[0]) === edit[1]) return prev;
      const next = new Map(prev);
      next.set(edit[0], edit[1]);
      return next;
    });
  };

  // Tô vùng: hình chữ nhật từ ô neo tới ô đang trỏ.
  const rectTo = (e: React.PointerEvent) => {
    const cell = cellFromEvent(e);
    const anchor = anchorRef.current;
    if (!cell || !anchor) return;
    const x0 = Math.min(anchor[0], cell[0]);
    const x1 = Math.max(anchor[0], cell[0]);
    const y0 = Math.min(anchor[1], cell[1]);
    const y1 = Math.max(anchor[1], cell[1]);
    const next = new Map<string, string | null>();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const edit = editFor(x, y);
        if (edit) next.set(edit[0], edit[1]);
      }
    }
    setPending(next);
  };

  const onDown = (e: React.PointerEvent) => {
    paintingRef.current = true;
    strokeToolRef.current = tool;
    gridRef.current?.setPointerCapture(e.pointerId);
    if (paintMode === 'rect') {
      anchorRef.current = cellFromEvent(e);
      rectTo(e);
    } else {
      brushAt(e);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!paintingRef.current) return;
    if (paintMode === 'rect') rectTo(e);
    else brushAt(e);
  };

  const countAtLayer = bounds.perLayer.get(curZ) ?? 0;

  return createPortal(
    <div className="import-screen">
      <div className="import-topbar">
        <span className="import-heading">🎨 Tô màu theo tầng</span>

        {bounds.valid && (
          <>
            {/* Chọn tầng */}
            <div className="tb-group">
              <span className="tb-glabel">Tầng Z</span>
              <button className="tb-icon" onClick={() => setLayer(curZ - 1)} disabled={curZ <= bounds.minZ} title="Xuống tầng dưới">
                ▼
              </button>
              <input
                type="range"
                min={bounds.minZ}
                max={bounds.maxZ}
                step={1}
                value={curZ}
                onChange={(e) => setLayer(Number(e.target.value))}
              />
              <button className="tb-icon" onClick={() => setLayer(curZ + 1)} disabled={curZ >= bounds.maxZ} title="Lên tầng trên">
                ▲
              </button>
              <span className="modal-dim">
                {curZ} / {bounds.minZ}…{bounds.maxZ} · {countAtLayer} khối
              </span>
            </div>

            {/* Công cụ */}
            <div className="tb-group">
              <span className="tb-glabel">Công cụ</span>
              <div className="seg">
                <button
                  className={tool === 'paint' ? 'active' : ''}
                  onClick={() => setTool('paint')}
                  title="Sơn lại màu khối có sẵn"
                >
                  🖌 Sơn
                </button>
                <button
                  className={tool === 'add' ? 'active' : ''}
                  onClick={() => setTool('add')}
                  title="Thêm khối (ô trống → tạo khối màu đang chọn)"
                >
                  ➕ Thêm
                </button>
                <button
                  className={tool === 'erase' ? 'active' : ''}
                  onClick={() => setTool('erase')}
                  title="Xóa khối"
                >
                  🧹 Xóa
                </button>
              </div>
            </div>

            {/* Kiểu tô */}
            <div className="tb-group">
              <span className="tb-glabel">Kiểu</span>
              <div className="seg">
                <button
                  className={paintMode === 'brush' ? 'active' : ''}
                  onClick={() => setPaintMode('brush')}
                  title="Tô từng ô theo nét kéo"
                >
                  ✏️ Lẻ
                </button>
                <button
                  className={paintMode === 'rect' ? 'active' : ''}
                  onClick={() => setPaintMode('rect')}
                  title="Giữ & kéo để tô cả vùng chữ nhật"
                >
                  ▭ Vùng
                </button>
              </div>
            </div>

            {/* Bảng màu */}
            <div className="tb-group">
              <span className="tb-glabel">Màu</span>
              <div className="swatches">
                {palette.map((c, i) => (
                  <button
                    key={i}
                    className={`swatch${c === color ? ' active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Màu tuỳ ý" />
              </div>
            </div>
          </>
        )}

        <div className="import-spacer" />
        <button className="create-btn" onClick={onClose}>
          Đóng
        </button>
      </div>

      <div className="layer-body">
        <div className="layer-left">
          {bounds.valid ? (
            <canvas
              ref={gridRef}
              className="layer-canvas"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => {
                paintingRef.current = false;
                anchorRef.current = null;
                commit();
              }}
            />
          ) : (
            <div className="model-info">Chưa có khối nào trong scene để tô.</div>
          )}
        </div>
        <div className="layer-right">
          <Canvas
            camera={{ position: [16, -16, 13], fov: 45, up: [0, 0, 1] }}
            style={{ width: '100%', height: '100%' }}
          >
            <color attach="background" args={['#15151a']} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[10, 12, 20]} intensity={1.2} />
            <directionalLight position={[-10, -8, 5]} intensity={0.4} />
            <PreviewMesh items={previewItems} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
          </Canvas>
        </div>
      </div>
    </div>,
    document.body,
  );
}
