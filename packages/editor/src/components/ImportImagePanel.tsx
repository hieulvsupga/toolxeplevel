import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import {
  crossSectionZRange,
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
type EditMode = 'paint' | 'erase' | 'none';
// Cách đổ màu khi định hình tầng.
type LayerColorFill = 'image' | 'wrap';

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

  // Định hình tầng: mỗi hàng thành mặt cắt tròn/vuông (bỏ qua độ dày khi bật).
  const [layerShape, setLayerShape] = useState<LayerShape>('off');
  // Đổ màu: theo cột ảnh, hoặc bọc ảnh quanh 4 mặt (nhìn 4 hướng đều thấy ảnh).
  const [layerColor, setLayerColor] = useState<LayerColorFill>('image');

  // Lưới màu GỐC (hex) đang chỉnh; null = ô trống. Màu hiển thị/tạo tuỳ colorMode.
  const [cells, setCells] = useState<(string | null)[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>('palette');
  const [editMode, setEditMode] = useState<EditMode>('none');
  // Nền preview: tối (mặc định) hoặc sáng cho dễ nhìn ảnh tối.
  const [lightBg, setLightBg] = useState(false);

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
        const zOff = Math.floor(W / 2); // canh Z giữa quanh 0 (đúng W ô)
        const xc = (xmin + xmax) / 2;
        const zc = (W - 1) / 2 - zOff; // tâm hình học theo Z (khớp với X)
        const y = rows - 1 - r;
        // Bọc ảnh 4 mặt: mặt trước/sau tô theo X, mặt trái/phải tô theo Z ->
        // nhìn từ 4 hướng chính đều thấy ảnh gốc.
        const wrapColor = (x: number, z: number): string | null => {
          const dx = x - xc;
          const dz = z - zc;
          const off = Math.abs(dz) >= Math.abs(dx) ? dx : dz;
          let sx = Math.round(xc + off);
          if (sx > xmax) sx = xmax;
          else if (sx < xmin) sx = xmin;
          return rowCol[sx];
        };
        for (let ix = 0; ix < W; ix++) {
          const x = xmin + ix;
          const zr = crossSectionZRange(layerShape, ix, W);
          if (!zr) continue;
          for (let iz = zr[0]; iz <= zr[1]; iz++) {
            const z = iz - zOff;
            const col = layerColor === 'wrap' ? wrapColor(x, z) : rowCol[x];
            if (!col) continue;
            items.push({ x: x - offX, y, z, color: col });
          }
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
    [rowStats, thickness, profile, layerShape, layerColor, colorMode, palette, cells, cols, rows],
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
          const dark = (r + c) % 2;
          ctx.fillStyle = lightBg
            ? dark
              ? '#d8d8e0'
              : '#eef0f4'
            : dark
              ? '#20202a'
              : '#191921';
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
  }, [cells, cols, rows, colorMode, palette, lightBg]);

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
    if (editMode === 'none') return; // chế độ xem, không sửa
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

  // Dịch toàn bộ pixel theo hướng (dr theo hàng, dc theo cột); ô ra ngoài bị bỏ.
  const shiftCells = (dr: number, dc: number) => {
    setCells((prev) => {
      if (!prev.length) return prev;
      const next: (string | null)[] = new Array(rows * cols).fill(null);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = prev[r * cols + c];
          if (!v) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          next[nr * cols + nc] = v;
        }
      }
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
            {/* Kích thước lưới */}
            <div className="tb-group">
              <span className="tb-glabel">Lưới</span>
              <input
                className="num"
                type="number"
                min={1}
                max={200}
                title="Số ô ngang"
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
              <span className="tb-x">×</span>
              <input
                className="num"
                type="number"
                min={1}
                max={200}
                title="Số ô dọc"
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
                dò {info.cols}×{info.rows}
              </button>
            </div>

            {/* Chỉnh ô: chế độ + màu nguồn + đối xứng */}
            <div className="tb-group">
              <span className="tb-glabel">Chỉnh</span>
              <div className="seg">
                <button
                  className={editMode === 'none' ? 'active' : ''}
                  onClick={() => setEditMode('none')}
                  title="Không vẽ/xóa — chỉ xem"
                >
                  🚫
                </button>
                <button
                  className={editMode === 'paint' ? 'active' : ''}
                  onClick={() => setEditMode('paint')}
                  title="Vẽ ô"
                >
                  ✏️ Vẽ
                </button>
                <button
                  className={editMode === 'erase' ? 'active' : ''}
                  onClick={() => setEditMode('erase')}
                  title="Xóa ô"
                >
                  🧹 Xóa
                </button>
              </div>
              <div className="seg">
                <button
                  className={colorMode === 'original' ? 'active' : ''}
                  onClick={() => setColorMode('original')}
                  title="Dùng màu gốc của ảnh"
                >
                  Màu ảnh
                </button>
                <button
                  className={colorMode === 'palette' ? 'active' : ''}
                  onClick={() => setColorMode('palette')}
                  title="Snap về bảng màu"
                >
                  Bảng màu
                </button>
              </div>
              <button className="create-btn" onClick={mirrorLeftToRight} title="Cân đối 2 bên">
                ⇋
              </button>
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
            </div>

            {/* Dựng khối 3D: độ dày + dáng (mờ khi định hình tầng) */}
            <div className={`tb-group${layerShape !== 'off' ? ' tb-off' : ''}`}>
              <span className="tb-glabel">Dày</span>
              <input
                className="num"
                type="number"
                min={1}
                max={64}
                disabled={layerShape !== 'off'}
                title={layerShape !== 'off' ? 'Đang định hình tầng — độ dày bị tắt' : 'Số lớp Z'}
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
            </div>

            {/* Định hình tầng (mặt cắt ngang) + màu tầng */}
            <div className="tb-group">
              <span className="tb-glabel">Tầng</span>
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
              {layerShape !== 'off' && (
                <div className="seg">
                  <button
                    className={layerColor === 'image' ? 'active' : ''}
                    onClick={() => setLayerColor('image')}
                    title="Đổ màu theo cột ảnh (mặc định)"
                  >
                    Theo ảnh
                  </button>
                  <button
                    className={layerColor === 'wrap' ? 'active' : ''}
                    onClick={() => setLayerColor('wrap')}
                    title="Bọc ảnh quanh 4 mặt — nhìn 4 hướng chính đều thấy ảnh"
                  >
                    ◎ Bọc 4 mặt
                  </button>
                </div>
              )}
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

      <div className={`import-stage${lightBg ? ' light' : ''}`}>
        <button
          className="bg-toggle"
          onClick={() => setLightBg((v) => !v)}
          title={lightBg ? 'Chuyển nền tối' : 'Chuyển nền sáng'}
        >
          {lightBg ? '🌙' : '☀️'}
        </button>
        {cells.length > 0 && (
          <div className="shift-pad" title="Dịch chuyển toàn bộ pixel">
            <button onClick={() => shiftCells(-1, 0)} title="Lên">▲</button>
            <div className="shift-mid">
              <button onClick={() => shiftCells(0, -1)} title="Trái">◀</button>
              <button onClick={() => shiftCells(0, 1)} title="Phải">▶</button>
            </div>
            <button onClick={() => shiftCells(1, 0)} title="Xuống">▼</button>
          </div>
        )}
        {cells.length ? (
          <>
            <canvas
              ref={previewRef}
              className="import-canvas"
              style={{ cursor: editMode === 'none' ? 'default' : 'crosshair' }}
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
