import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import {
  crossSectionZ,
  detectGrid,
  hexToRgb,
  LAYER_SHAPES,
  loadImageData,
  PROFILES,
  profileFactor,
  rowZLayers,
  sampleGrid,
  snapToPalette,
  type DepthProfile,
  type GridInfo,
  type LayerShape,
} from '../lib/imageVoxelizer';

interface ImportImagePanelProps {
  onClose: () => void;
  initialFile?: File;
}

type ColorMode = 'original' | 'palette';
type EditMode = 'paint' | 'erase';

const rgbToHex = (c: [number, number, number]) =>
  '#' +
  c
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');

export function ImportImagePanel({ onClose, initialFile }: ImportImagePanelProps) {
  const palette = useEditor((s) => s.palette);
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const stampVoxels = useEditor((s) => s.stampVoxels);

  const [img, setImg] = useState<ImageData | null>(null);
  const [info, setInfo] = useState<GridInfo | null>(null);
  const [cols, setCols] = useState(32);
  const [rows, setRows] = useState(32);
  const [colsText, setColsText] = useState('32');
  const [rowsText, setRowsText] = useState('32');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Độ dày (số lớp Z) + dáng khối phân bố độ dày theo chiều cao.
  const [thickness, setThickness] = useState(1);
  const [thicknessText, setThicknessText] = useState('1');
  const [profile, setProfile] = useState<DepthProfile>('box');

  // Định hình tầng: mỗi hàng thành mặt cắt tròn/vuông/tam giác (bỏ qua độ dày khi bật).
  const [layerShape, setLayerShape] = useState<LayerShape>('off');

  // Lưới màu GỐC (hex) đang chỉnh; null = ô trống. Màu hiển thị/tạo tuỳ colorMode.
  const [cells, setCells] = useState<(string | null)[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>('palette');
  const [editMode, setEditMode] = useState<EditMode>('paint');

  const previewRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

  const clampThickness = (v: number) => Math.max(1, Math.min(64, Math.round(v) || 1));

  const pixelAspect = (gi: GridInfo) =>
    (gi.bbox.maxY - gi.bbox.minY + 1) / (gi.bbox.maxX - gi.bbox.minX + 1);
  const clampDim = (v: number) => Math.max(2, Math.min(200, Math.round(v) || 2));

  const setDims = (c: number, r: number) => {
    setCols(c);
    setRows(r);
    setColsText(String(c));
    setRowsText(String(r));
  };

  // Màu hiển thị của 1 ô theo chế độ: gốc hoặc snap về bảng màu.
  const displayColor = (cell: string | null): string | null => {
    if (!cell) return null;
    return colorMode === 'palette' ? snapToPalette(hexToRgb(cell), palette) : cell;
  };

  // Lấy mẫu lại từ ảnh (màu gốc) khi ảnh/độ phân giải đổi.
  useEffect(() => {
    if (!img || !info) {
      setCells([]);
      return;
    }
    const s = sampleGrid(img, info, cols, rows);
    setCells(s.cells.map((c) => (c ? rgbToHex(c) : null)));
  }, [img, info, cols, rows]);

  // Số ô đã tô mỗi hàng + phạm vi hàng có khối (để chuẩn hoá chiều cao cho dáng).
  const rowStats = useMemo(() => {
    const rowCount = new Array(rows).fill(0);
    let minR = rows;
    let maxR = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r * cols + c]) {
          rowCount[r]++;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
      }
    }
    return { rowCount, minR, maxR };
  }, [cells, cols, rows]);

  // Các lớp Z tại 1 hàng theo dáng đã chọn. r=maxR là chân, r=minR là đỉnh.
  const rowZs = (r: number): number[] => {
    const { minR, maxR } = rowStats;
    if (maxR < 0) return [0];
    const span = Math.max(1, maxR - minR);
    const f = (maxR - r) / span; // 0 ở chân, 1 ở đỉnh
    return rowZLayers(thickness, profileFactor(profile, f));
  };

  // Dựng danh sách khối 3D theo chế độ đang chọn.
  const buildItems = (): { x: number; y: number; z: number; color: string }[] => {
    const items: { x: number; y: number; z: number; color: string }[] = [];
    if (!cells.length) return items;
    const offX = Math.floor(cols / 2);

    if (layerShape !== 'off') {
      // Mỗi hàng -> mặt cắt ngang theo bề rộng hàng đó.
      for (let r = 0; r < rows; r++) {
        let xmin = cols;
        let xmax = -1;
        for (let c = 0; c < cols; c++) {
          if (cells[r * cols + c]) {
            if (c < xmin) xmin = c;
            if (c > xmax) xmax = c;
          }
        }
        if (xmax < 0) continue;
        // Màu theo cột trong hàng, lấp khoảng trống bằng màu lân cận.
        const rowCol = new Array<string | null>(cols).fill(null);
        for (let c = xmin; c <= xmax; c++) rowCol[c] = displayColor(cells[r * cols + c]);
        let last: string | null = null;
        for (let c = xmin; c <= xmax; c++) (last = rowCol[c] ?? last), (rowCol[c] = last);
        let next: string | null = null;
        for (let c = xmax; c >= xmin; c--) (next = rowCol[c] ?? next), (rowCol[c] = next);

        const W = xmax - xmin + 1;
        const R = W / 2;
        const xc = (xmin + xmax) / 2;
        const y = rows - 1 - r;
        for (let x = xmin; x <= xmax; x++) {
          const col = rowCol[x];
          if (!col) continue;
          const zr = crossSectionZ(layerShape, x - xc, R);
          if (!zr) continue;
          for (let z = zr[0]; z <= zr[1]; z++) items.push({ x: x - offX, y, z, color: col });
        }
      }
    } else {
      // Chế độ độ dày + dáng khối.
      for (let r = 0; r < rows; r++) {
        const zs = rowZs(r);
        for (let c = 0; c < cols; c++) {
          const col = displayColor(cells[r * cols + c]);
          if (!col) continue;
          const y = rows - 1 - r;
          for (const z of zs) items.push({ x: c - offX, y, z, color: col });
        }
      }
    }
    return items;
  };

  const estBlocks = useMemo(
    () => buildItems().length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowStats, thickness, profile, layerShape, colorMode, palette, cells, cols, rows],
  );

  const mirrorLeftToRight = () => {
    setCells((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      const half = Math.floor(cols / 2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < half; c++) {
          next[r * cols + (cols - 1 - c)] = prev[r * cols + c];
        }
      }
      return next;
    });
  };

  // Vẽ preview.
  useEffect(() => {
    const cv = previewRef.current;
    if (!cv || !cells.length) return;
    const px = 12;
    cv.width = cols * px;
    cv.height = rows * px;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = displayColor(cells[r * cols + c]);
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(c * px, r * px, px, px);
        } else {
          ctx.fillStyle = (r + c) % 2 ? '#20202a' : '#191921';
          ctx.fillRect(c * px, r * px, px, px);
        }
      }
    }
    ctx.strokeStyle = 'rgba(127,214,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo((cols / 2) * px, 0);
    ctx.lineTo((cols / 2) * px, cv.height);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, cols, rows, colorMode, palette]);

  // Vẽ preview mặt BÊN (nhìn ngang) để thấy dáng khối theo độ dày.
  useEffect(() => {
    const cv = sideRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const w = cv.width;
    const h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#191921';
    ctx.fillRect(0, 0, w, h);
    if (rowStats.maxR < 0) return;
    const rowH = h / rows;
    const maxT = Math.max(1, thickness);
    const scale = w / (maxT + 1); // chừa lề
    const cx = w / 2;
    ctx.fillStyle = '#4b86c9';
    for (let r = 0; r < rows; r++) {
      if (!rowStats.rowCount[r]) continue;
      const bw = rowZs(r).length * scale;
      ctx.fillRect(cx - bw / 2, r * rowH, bw, Math.ceil(rowH));
    }
    // trục giữa (z=0)
    ctx.strokeStyle = 'rgba(127,214,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowStats, rows, thickness, profile]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const data = await loadImageData(file);
      const gi = detectGrid(data);
      setImg(data);
      setInfo(gi);
      setDims(gi.cols, clampDim(gi.cols * pixelAspect(gi)));
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialFile) readFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // ----- Vẽ/xóa ô trên preview -----
  const cellIndexFromEvent = (e: React.PointerEvent): number | null => {
    const cv = previewRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return r * cols + c;
  };

  const applyEditAt = (e: React.PointerEvent) => {
    const idx = cellIndexFromEvent(e);
    if (idx == null) return;
    setCells((prev) => {
      const val = editMode === 'erase' ? null : color;
      if (prev[idx] === val) return prev;
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const handleCreate = () => {
    const items = buildItems();
    if (!items.length) return;
    stampVoxels(items);
    onClose();
  };

  return createPortal(
    <div className="import-screen">
      <div className="import-topbar">
        <span className="import-heading">🖼 Import ảnh → khối</span>

        <label className="file-btn">
          {img ? 'Chọn ảnh khác' : 'Chọn ảnh…'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              readFile(f);
            }}
          />
        </label>

        {info && (
          <>
            <div className="import-ctrl">
              <label>Rộng</label>
              <input
                type="number"
                min={1}
                max={200}
                value={colsText}
                onChange={(e) => {
                  const t = e.target.value;
                  setColsText(t);
                  const n = Number(t);
                  if (t !== '' && Number.isFinite(n) && n >= 1) {
                    const c = Math.min(200, n);
                    setCols(c);
                    const r = clampDim(c * pixelAspect(info));
                    setRows(r);
                    setRowsText(String(r));
                  }
                }}
                onBlur={() => {
                  const n = clampDim(Number(colsText));
                  setDims(n, clampDim(n * pixelAspect(info)));
                }}
              />
              <label>Cao</label>
              <input
                type="number"
                min={1}
                max={200}
                value={rowsText}
                onChange={(e) => {
                  const t = e.target.value;
                  setRowsText(t);
                  const n = Number(t);
                  if (t !== '' && Number.isFinite(n) && n >= 1) setRows(Math.min(200, n));
                }}
                onBlur={() => setDims(cols, clampDim(Number(rowsText)))}
              />
              <button className="link-btn" onClick={() => setDims(info.cols, info.rows)}>
                dò: {info.cols}×{info.rows}
              </button>
            </div>

            {/* Switch chế độ màu */}
            <div className="seg">
              <button
                className={colorMode === 'original' ? 'active' : ''}
                onClick={() => setColorMode('original')}
              >
                Màu ảnh
              </button>
              <button
                className={colorMode === 'palette' ? 'active' : ''}
                onClick={() => setColorMode('palette')}
              >
                Bảng màu
              </button>
            </div>

            {/* Công cụ sửa ô */}
            <div className="seg">
              <button
                className={editMode === 'paint' ? 'active' : ''}
                onClick={() => setEditMode('paint')}
              >
                ✏️ Vẽ
              </button>
              <button
                className={editMode === 'erase' ? 'active' : ''}
                onClick={() => setEditMode('erase')}
              >
                🧹 Xóa
              </button>
            </div>

            {editMode === 'paint' && (
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
              </div>
            )}

            <button className="create-btn" onClick={mirrorLeftToRight} title="Cân đối 2 bên">
              ⇋ Đối xứng
            </button>

            {/* Độ dày theo trục Z (tắt khi đang định hình tầng) */}
            <div className="import-ctrl">
              <label>Độ dày</label>
              <input
                type="number"
                min={1}
                max={64}
                disabled={layerShape !== 'off'}
                title={layerShape !== 'off' ? 'Đang định hình tầng — độ dày bị tắt' : undefined}
                value={thicknessText}
                onChange={(e) => {
                  const t = e.target.value;
                  setThicknessText(t);
                  const n = Number(t);
                  if (t !== '' && Number.isFinite(n) && n >= 1) setThickness(Math.min(64, n));
                }}
                onBlur={() => {
                  const n = clampThickness(Number(thicknessText));
                  setThickness(n);
                  setThicknessText(String(n));
                }}
              />
            </div>

            {/* Dáng khối (theo chiều cao) */}
            <div className="seg">
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  className={profile === p.id ? 'active' : ''}
                  onClick={() => setProfile(p.id)}
                  disabled={thickness <= 1 || layerShape !== 'off'}
                  title={
                    layerShape !== 'off'
                      ? 'Đang định hình tầng'
                      : thickness <= 1
                        ? 'Tăng độ dày > 1 để dùng dáng'
                        : p.label
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Định hình tầng (mặt cắt ngang) */}
            <div className="import-ctrl">
              <label>Tầng</label>
              <div className="seg">
                {LAYER_SHAPES.map((s) => (
                  <button
                    key={s.id}
                    className={layerShape === s.id ? 'active' : ''}
                    onClick={() => setLayerShape(s.id)}
                    title={
                      s.id === 'off'
                        ? 'Tắt định hình tầng, dùng độ dày/dáng'
                        : `Mỗi tầng thành mặt cắt ${s.label}`
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <span className="modal-dim">≈ {estBlocks} khối</span>
          </>
        )}

        {err && <span className="modal-err">{err}</span>}

        <div className="import-spacer" />

        {info && (
          <button className="primary create-btn" onClick={handleCreate}>
            Tạo {estBlocks} khối
          </button>
        )}
        <button className="create-btn" onClick={onClose}>
          Đóng
        </button>
      </div>

      <div className="import-stage">
        {cells.length ? (
          <>
            <canvas
              ref={previewRef}
              className="import-canvas"
              onPointerDown={(e) => {
                paintingRef.current = true;
                previewRef.current?.setPointerCapture(e.pointerId);
                applyEditAt(e);
              }}
              onPointerMove={(e) => {
                if (paintingRef.current) applyEditAt(e);
              }}
              onPointerUp={() => (paintingRef.current = false)}
              onPointerLeave={() => (paintingRef.current = false)}
            />
            {layerShape === 'off' && thickness > 1 && (
              <div className="side-preview">
                <div className="side-preview-label">Mặt bên</div>
                <canvas ref={sideRef} width={72} height={260} />
              </div>
            )}
          </>
        ) : (
          <label className="dropzone">
            <div className="dropzone-big">
              {busy ? 'Đang xử lý…' : '＋ Bấm để chọn ảnh pixel-art'}
            </div>
            <div className="dropzone-sub">
              Tool sẽ tự dò lưới, bỏ nền, và tạo 1 lớp khối. Sau khi có ảnh bạn có thể
              vẽ/xóa từng ô và đổi giữa màu gốc / bảng màu.
            </div>
            <input
              type="file"
              accept="image/*"
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
