import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WALL_HEX, matchGameColor } from '@voxel/core';
import { useEditor } from '../store';
import { PaletteSwatches } from './PaletteSwatches';
import { yUpToEditorAll } from '../lib/axis';
import { fillGridCell } from '../lib/wallCell';
import {
  crossSectionZRange,
  detectGrid,
  LAYER_SHAPES,
  loadImageData,
  sampleGrid,
  zLayers,
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

/** Trần cỡ ngòi. 32 đã quét gần hết một lưới cỡ thường, to hơn thì kéo một nét là xoá sạch ảnh. */
const MAX_BRUSH = 32;

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

  // Độ dày (số lớp Z) — nay là một ô của nhóm lưới, mặc định 1 (ảnh phẳng đúng 1 lớp).
  const [thickness, setThickness] = useState(1);
  const [thicknessText, setThicknessText] = useState('1');

  // Định hình tầng: mỗi hàng thành mặt cắt tròn/vuông (bỏ qua độ dày khi bật).
  const [layerShape, setLayerShape] = useState<LayerShape>('off');
  // Đổ màu: theo cột ảnh, hoặc bọc ảnh quanh 4 mặt (nhìn 4 hướng đều thấy ảnh).
  const [layerColor, setLayerColor] = useState<LayerColorFill>('image');

  // Lưới màu GỐC (hex) đang chỉnh; null = ô trống. Màu hiển thị/tạo tuỳ colorMode.
  const [cells, setCells] = useState<(string | null)[]>([]);
  // Cố định ở 'palette': ô chọn "Màu ảnh / Bảng màu" đang tạm ẩn nên không còn gì đổi giá trị này.
  // Vẫn giữ biến (thay vì gỡ sạch) để mọi chỗ tính màu bên dưới không phải sửa khi bật lại.
  const colorMode: ColorMode = 'palette';
  const [editMode, setEditMode] = useState<EditMode>('none');
  // Cỡ ngòi: một nét chạm vào ô vuông brush×brush quanh ô đang trỏ (brush=1 là từng ô như trước).
  const [brush, setBrush] = useState(1);
  const [brushText, setBrushText] = useState('1');
  /** Ô đang rê chuột qua — để vẽ khung xem trước vùng ngòi sẽ ăn vào. */
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  // Nền preview: tối (mặc định) hoặc sáng cho dễ nhìn ảnh tối.
  const [lightBg, setLightBg] = useState(false);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  /** Ô của lần chấm trước trong cùng một nét kéo — để nối liền, xem `applyStrokeAt`. */
  const lastCellRef = useRef<{ r: number; c: number } | null>(null);

  const clampThickness = (v: number) => Math.max(1, Math.min(64, Math.round(v) || 1));
  const clampBrush = (v: number) => Math.max(1, Math.min(MAX_BRUSH, Math.round(v) || 1));

  const pixelAspect = (gi: GridInfo) =>
    (gi.bbox.maxY - gi.bbox.minY + 1) / (gi.bbox.maxX - gi.bbox.minX + 1);
  const clampDim = (v: number) => Math.max(2, Math.min(200, Math.round(v) || 2));

  const setDims = (c: number, r: number) => {
    setCols(c);
    setRows(r);
    setColsText(String(c));
    setRowsText(String(r));
  };

  /** hex (chữ hoa) -> hex gốc trong bảng màu, để nhận ra ô đã mang đúng một màu của bảng. */
  const paletteByHex = useMemo(
    () => new Map(palette.map((c) => [c.toUpperCase(), c])),
    [palette],
  );

  /**
   * Màu hiển thị của 1 ô: màu ảnh gốc, hoặc quy về bảng màu game.
   *
   * Phép quy dùng `matchGameColor` — đúng cái mà lúc xuất .asset dùng — nên hai chỗ không bao giờ
   * lệch nhau, và được hai thứ quan trọng của nó:
   *
   *  - KHÔNG bao giờ tự sinh ra tường. Trước đây phép dò xét cả ô tường, nên mọi pixel xám xám
   *    trong ảnh lặng lẽ thành khối tường: người dựng chỉ chọn màu mà lại ra mechanic (khối không
   *    bắn được, không tính vào điều kiện thắng) và phải mở bảng Xuất mới thấy. Muốn tường thì tô
   *    tay bằng nút 🧱 Tường.
   *  - Đo trong Lab chứ không phải RGB thô: xám #888 ra DarkGray, chứ không phải Brown như phép đo
   *    RGB cũ (khoảng cách RGB đánh giá sai nặng ở màu xám và màu bão hoà).
   */
  const displayColor = (cell: string | null): string | null => {
    if (!cell) return null;
    if (colorMode !== 'palette') return cell;
    // Ô do người dùng tự tô thì đã là một màu trong bảng — giữ nguyên, KỂ CẢ ô tường.
    const exact = paletteByHex.get(cell.toUpperCase());
    if (exact) return exact;
    return matchGameColor(cell).color.hex;
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

  // Các lớp Z của một hàng. Bỏ dáng gọt theo chiều cao rồi nên hàng nào cũng dày như nhau.
  const rowZs = (): number[] => zLayers(thickness);

  // Dựng danh sách khối 3D theo chế độ đang chọn.
  // Bên trong hàm này ảnh vẫn được nghĩ theo hệ Y-up quen thuộc (y = chiều cao ảnh, z = bề dày);
  // quy về hệ trục editor một lần duy nhất ở câu return cuối.
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
      // Chế độ độ dày phẳng: mọi hàng cùng số lớp Z.
      const zs = rowZs();
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const col = displayColor(cells[r * cols + c]);
          if (!col) continue;
          const y = rows - 1 - r;
          for (const z of zs) items.push({ x: c - offX, y, z, color: col });
        }
      }
    }
    return yUpToEditorAll(items);
  };

  const estBlocks = useMemo(
    () => buildItems().length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowStats, thickness, layerShape, layerColor, colorMode, palette, cells, cols, rows],
  );

  // Ô tường (tô tay) — hiện luôn số lượng để biết bàn này có mechanic hay không, khỏi phải mở bảng
  // Xuất mới thấy.
  const wallCells = useMemo(() => {
    let n = 0;
    for (const c of cells) if (c && displayColor(c) === WALL_HEX) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, palette]);

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
          // Cùng cách vẽ với lưới "Tô tầng": ô tường ra mạch gạch, không lẫn với màu xám thường.
          fillGridCell(ctx, c * px, r * px, px, col);
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

  // Khung xem trước vùng ngòi, vẽ trên một canvas phủ lên trên: để chung với lưới thì mỗi lần nhích
  // chuột phải tô lại toàn bộ ô (lưới tối đa 200×200), còn đây chỉ là một khung chữ nhật.
  useEffect(() => {
    const cv = brushRef.current;
    if (!cv) return;
    const px = 12;
    cv.width = cols * px;
    cv.height = rows * px;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!hover || editMode === 'none') return;
    const box = brushBox(hover.r, hover.c);
    const x = box.c0 * px;
    const y = box.r0 * px;
    const w = (box.c1 - box.c0 + 1) * px;
    const h = (box.r1 - box.r0 + 1) * px;
    // Viền đen dưới, trắng trên: nền lưới có cả ô sáng lẫn ô tối nên một màu là có chỗ chìm mất.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = editMode === 'erase' ? '#ff9db0' : '#ffffff';
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, brush, cols, rows, editMode]);

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
      const bw = rowZs().length * scale;
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
  }, [rowStats, rows, thickness]);

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
  const cellFromEvent = (e: React.PointerEvent): { r: number; c: number } | null => {
    const cv = previewRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return { r, c };
  };

  /**
   * Ô vuông brush×brush mà ngòi ăn vào khi trỏ tại (r, c) — đã kẹp trong lưới.
   *
   * Ngòi lẻ có ô chính giữa nên vùng ăn cân đều quanh con trỏ. Ngòi chẵn thì không, phải lệch một
   * bên: offset = floor((n-1)/2) cho vùng nhô xuống-phải nửa ô, tức ô đang trỏ là ô trên-trái của
   * vùng — cùng quy ước với ngòi vuông của các app vẽ pixel, và ô đang trỏ luôn nằm trong vùng ăn.
   */
  const brushBox = (r: number, c: number) => {
    const off = Math.floor((brush - 1) / 2);
    return {
      r0: Math.max(0, r - off),
      c0: Math.max(0, c - off),
      r1: Math.min(rows - 1, r - off + brush - 1),
      c1: Math.min(cols - 1, c - off + brush - 1),
    };
  };

  /**
   * Chấm ngòi tại (r, c), và nối liền từ ô của lần chấm trước trong cùng nét kéo.
   *
   * Phải nối vì `pointermove` chỉ bắn ra vài chục điểm mỗi giây: kéo nhanh là hai điểm liên tiếp
   * cách nhau chục ô, chấm rời từng điểm thì nét ra thành các mảng đứt quãng.
   */
  const applyStrokeAt = (r: number, c: number) => {
    const val = editMode === 'erase' ? null : color;
    const last = lastCellRef.current;
    lastCellRef.current = { r, c };
    setCells((prev) => {
      if (!prev.length) return prev;
      let next: (string | null)[] | null = null;
      const steps = last ? Math.max(Math.abs(r - last.r), Math.abs(c - last.c)) : 0;
      for (let i = 0; i <= steps; i++) {
        const rr = last && steps ? Math.round(last.r + ((r - last.r) * i) / steps) : r;
        const cc = last && steps ? Math.round(last.c + ((c - last.c) * i) / steps) : c;
        const box = brushBox(rr, cc);
        for (let br = box.r0; br <= box.r1; br++) {
          for (let bc = box.c0; bc <= box.c1; bc++) {
            const idx = br * cols + bc;
            if (prev[idx] === val) continue;
            // Chỉ nhân bản mảng khi thật sự có ô đổi — rê chuột trong vùng đã tô thì không tạo
            // state mới, khỏi vẽ lại canvas mỗi lần nhích chuột.
            if (!next) next = [...prev];
            next[idx] = val;
          }
        }
      }
      return next ?? prev;
    });
  };

  const applyEditAt = (e: React.PointerEvent) => {
    if (editMode === 'none') return; // chế độ xem, không sửa
    const cell = cellFromEvent(e);
    if (!cell) return;
    applyStrokeAt(cell.r, cell.c);
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
              {/* Độ dày nằm luôn trong nhóm lưới: nó chính là chiều thứ ba của lưới, mặc định 1 =
                  ảnh phẳng đúng một lớp. Nhãn đặt TRƯỚC ô nhập, không thì đọc thành "3 × 4 × 1 dày". */}
              <span className="tb-glabel">dày</span>
              <input
                className="num"
                type="number"
                min={1}
                max={64}
                disabled={layerShape !== 'off'}
                title={
                  layerShape !== 'off'
                    ? 'Đang định hình tầng — độ dày bị tắt'
                    : 'Độ dày: số lớp theo chiều sâu'
                }
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
              {/* Cỡ ngòi: chung cho cả vẽ lẫn xoá, đúng như ngòi bút của app vẽ — một nét ăn cả ô
                  vuông n×n chứ không phải từng ô. Hiện cả thanh kéo lẫn ô số: kéo để thử nhanh,
                  gõ số khi cần đúng một cỡ. */}
              {editMode !== 'none' && (
                <>
                  <span className="tb-glabel">Ngòi</span>
                  <input
                    className="brush-range"
                    type="range"
                    min={1}
                    max={MAX_BRUSH}
                    value={brush}
                    title={`Cỡ ngòi: mỗi nét ăn ${brush}×${brush} ô`}
                    onChange={(e) => {
                      const n = clampBrush(Number(e.target.value));
                      setBrush(n);
                      setBrushText(String(n));
                    }}
                  />
                  <input
                    className="num"
                    type="number"
                    min={1}
                    max={MAX_BRUSH}
                    title={`Cỡ ngòi (1–${MAX_BRUSH} ô)`}
                    value={brushText}
                    onChange={(e) => {
                      const t = e.target.value;
                      setBrushText(t);
                      const n = Number(t);
                      if (t !== '' && Number.isFinite(n) && n >= 1) setBrush(clampBrush(n));
                    }}
                    onBlur={() => {
                      const n = clampBrush(Number(brushText));
                      setBrush(n);
                      setBrushText(String(n));
                    }}
                  />
                  <span className="tb-x">
                    {brush}×{brush} ô
                  </span>
                </>
              )}
              {/* Cặp nút "Màu ảnh / Bảng màu" tạm ẩn theo yêu cầu — luôn chạy ở chế độ bảng màu.
                  Bật lại thì render lại khối `.seg` này và đổi `colorMode` về `useState`. */}
              {/* Ghi hẳn chữ thay vì mỗi ký hiệu ⇋: nút này làm một việc rất cụ thể (lấy nửa trái
                  lật sang phải), mà cái ký hiệu thì chẳng nói được điều đó. */}
              <button
                className="create-btn"
                onClick={mirrorLeftToRight}
                title="Lấy nửa TRÁI của lưới lật sang phải cho hai bên cân nhau"
              >
                Đối xứng trái → phải
              </button>
              {editMode === 'paint' && (
                <div className="swatches">
                  <PaletteSwatches />
                </div>
              )}
            </div>

            {/* Mechanic của khối — cùng lối vào có tên như toolbar chính và bảng Tô lớp. Ô tường
                vốn nằm sẵn cuối dãy bảng màu, nhưng ở màn nhập ảnh thì chẳng ai đoán ra rằng cái ô
                gạch đó là một cơ chế chứ không phải một màu xám. */}
            <div className="tb-group">
              <span className="tb-glabel">Mechanic</span>
              <button
                className={color === WALL_HEX ? 'active' : ''}
                onClick={() => {
                  setColor(WALL_HEX);
                  // Bấm tường là để VẼ tường — đang ở chế độ xem/xoá thì tự chuyển sang vẽ, không
                  // thì bấm xong tô mãi không ra gì.
                  if (editMode !== 'paint') setEditMode('paint');
                }}
                title="Tường: khối không bao giờ bị phá, không súng nào bắn được, dùng để bịt hướng bắn — bấm rồi vẽ như một màu thường. Phép dò màu từ ảnh KHÔNG bao giờ tự sinh ra tường, phải tô tay ở đây."
              >
                🧱 Tường{wallCells ? ` (${wallCells})` : ''}
              </button>
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

            <span className="modal-dim">
              ≈ {estBlocks} khối{wallCells ? ` · ${wallCells} ô tường` : ''}
            </span>
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
            <div className="import-canvas-wrap">
              <canvas
                ref={previewRef}
                className="import-canvas"
                style={{ cursor: editMode === 'none' ? 'default' : 'crosshair' }}
                onPointerDown={(e) => {
                  paintingRef.current = true;
                  // Nét mới bắt đầu từ đây, không nối vào ô cuối của nét trước.
                  lastCellRef.current = null;
                  previewRef.current?.setPointerCapture(e.pointerId);
                  applyEditAt(e);
                }}
                onPointerMove={(e) => {
                  setHover(cellFromEvent(e));
                  if (paintingRef.current) applyEditAt(e);
                }}
                onPointerUp={() => {
                  paintingRef.current = false;
                  lastCellRef.current = null;
                }}
                onPointerLeave={() => {
                  paintingRef.current = false;
                  lastCellRef.current = null;
                  setHover(null);
                }}
              />
              <canvas ref={brushRef} className="import-brush-overlay" />
            </div>
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
