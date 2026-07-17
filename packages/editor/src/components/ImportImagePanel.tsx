import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store';
import {
  detectGrid,
  hexToRgb,
  loadImageData,
  sampleGrid,
  snapToPalette,
  type GridInfo,
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

  // Lưới màu GỐC (hex) đang chỉnh; null = ô trống. Màu hiển thị/tạo tuỳ colorMode.
  const [cells, setCells] = useState<(string | null)[]>([]);
  const [colorMode, setColorMode] = useState<ColorMode>('palette');
  const [editMode, setEditMode] = useState<EditMode>('paint');

  const previewRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);

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

  const filledCount = useMemo(() => cells.filter(Boolean).length, [cells]);

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
    if (!cells.length) return;
    const offX = Math.floor(cols / 2);
    const items: { x: number; y: number; z: number; color: string }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = displayColor(cells[r * cols + c]);
        if (!col) continue;
        items.push({ x: c - offX, y: rows - 1 - r, z: 0, color: col });
      }
    }
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
            <span className="modal-dim">≈ {filledCount} khối</span>
          </>
        )}

        {err && <span className="modal-err">{err}</span>}

        <div className="import-spacer" />

        {info && (
          <button className="primary create-btn" onClick={handleCreate}>
            Tạo {filledCount} khối
          </button>
        )}
        <button className="create-btn" onClick={onClose}>
          Đóng
        </button>
      </div>

      <div className="import-stage">
        {cells.length ? (
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
