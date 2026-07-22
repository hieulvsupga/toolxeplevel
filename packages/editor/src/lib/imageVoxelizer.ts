/** Chuyển ảnh pixel-art 2D thành lưới màu để dựng voxel. */

export interface GridInfo {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  bg: [number, number, number];
  tol: number;
  cell: number; // kích thước ô gốc (px) ước lượng
  cols: number;
  rows: number;
}

/** Kết quả lấy mẫu: mảng cols*rows, mỗi phần tử là [r,g,b] hoặc null (nền). */
export interface SampledGrid {
  cols: number;
  rows: number;
  cells: ([number, number, number] | null)[];
}

function dist2(r: number, g: number, b: number, c: [number, number, number]): number {
  const dr = r - c[0];
  const dg = g - c[1];
  const db = b - c[2];
  return dr * dr + dg * dg + db * db;
}

export function loadImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Không tạo được canvas context'));
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh'));
    };
    img.src = url;
  });
}

/** Màu nền = trung bình 4 góc ảnh. */
function cornerBg(data: Uint8ClampedArray, W: number, H: number): [number, number, number] {
  const pts = [
    [2, 2],
    [W - 3, 2],
    [2, H - 3],
    [W - 3, H - 3],
  ];
  let r = 0,
    g = 0,
    b = 0;
  for (const [x, y] of pts) {
    const i = (y * W + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [r / 4, g / 4, b / 4];
}

/**
 * Tìm chu kỳ lưới (px/ô) trên 1 tín hiệu 1D bằng autocorrelation của gradient.
 * Làm mượt hoạ tiết trong ô, chỉ còn lại tính tuần hoàn của đường lưới thật.
 */
function detectPeriod(signal: number[], minP: number, maxP: number): number {
  const n = signal.length;
  if (n < minP * 2) return Math.max(1, n);
  const grad = new Float64Array(n);
  for (let i = 1; i < n; i++) grad[i] = Math.abs(signal[i] - signal[i - 1]);

  const cap = Math.min(maxP, Math.floor(n / 2));
  const scores = new Float64Array(cap + 1);
  let bestP = minP;
  let best = -1;
  for (let p = minP; p <= cap; p++) {
    let s = 0;
    for (let i = p; i < n; i++) s += grad[i] * grad[i - p];
    s /= n - p;
    scores[p] = s;
    if (s > best) {
      best = s;
      bestP = p;
    }
  }
  // Ưu tiên chu kỳ CƠ BẢN: nếu ước của bestP cũng mạnh thì lấy ước nhỏ hơn
  // (tránh nhầm chọn bội số 2×/3× của ô thật).
  for (const k of [4, 3, 2]) {
    const c = Math.round(bestP / k);
    if (c >= minP && scores[c] >= 0.5 * best) return c;
  }
  return bestP;
}

/** Trung bình độ sáng theo cột & theo hàng trong bbox. */
function axisLuma(
  data: Uint8ClampedArray,
  W: number,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): { col: number[]; row: number[] } {
  const bw = b.maxX - b.minX + 1;
  const bh = b.maxY - b.minY + 1;
  const colSum = new Float64Array(bw);
  const rowSum = new Float64Array(bh);
  for (let y = b.minY; y <= b.maxY; y++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      const i = (y * W + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      colSum[x - b.minX] += lum;
      rowSum[y - b.minY] += lum;
    }
  }
  for (let i = 0; i < bw; i++) colSum[i] /= bh;
  for (let j = 0; j < bh; j++) rowSum[j] /= bw;
  return { col: Array.from(colSum), row: Array.from(rowSum) };
}

export function detectGrid(img: ImageData): GridInfo {
  const { width: W, height: H, data } = img;
  const bg = cornerBg(data, W, H);
  const tol = 60;
  const tol2 = tol * tol;

  const isFg = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    if (data[i + 3] < 24) return false; // trong suốt -> nền
    return dist2(data[i], data[i + 1], data[i + 2], bg) > tol2;
  };

  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFg(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    minX = 0;
    minY = 0;
    maxX = W - 1;
    maxY = H - 1;
  }
  const bbox = { minX, minY, maxX, maxY };
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const { col, row } = axisLuma(data, W, bbox);
  const cellW = detectPeriod(col, 3, 600);
  const cellH = detectPeriod(row, 3, 600);
  const cols = Math.max(1, Math.min(300, Math.round(bw / cellW)));
  const rows = Math.max(1, Math.min(300, Math.round(bh / cellH)));
  return { bbox, bg, tol, cell: (cellW + cellH) / 2, cols, rows };
}

/** Lấy mẫu 1 màu / ô (trung bình vùng tâm ô). */
export function sampleGrid(img: ImageData, info: GridInfo, cols: number, rows: number): SampledGrid {
  const { width: W, data } = img;
  const { minX, minY, maxX, maxY } = info.bbox;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const cw = bw / cols;
  const ch = bh / rows;
  const tol2 = info.tol * info.tol;
  const cells: ([number, number, number] | null)[] = new Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx0 = minX + c * cw;
      const cy0 = minY + r * ch;
      // vùng lấy mẫu = 60% giữa ô
      const sx0 = Math.floor(cx0 + cw * 0.2);
      const sx1 = Math.ceil(cx0 + cw * 0.8);
      const sy0 = Math.floor(cy0 + ch * 0.2);
      const sy1 = Math.ceil(cy0 + ch * 0.8);
      let sr = 0,
        sg = 0,
        sb = 0,
        sa = 0,
        n = 0;
      const step = Math.max(1, Math.floor(Math.min(cw, ch) / 6));
      for (let y = sy0; y < sy1; y += step) {
        for (let x = sx0; x < sx1; x += step) {
          const i = (y * W + x) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
          sa += data[i + 3];
          n++;
        }
      }
      if (!n) {
        cells[r * cols + c] = null;
        continue;
      }
      const ar = sr / n,
        ag = sg / n,
        ab = sb / n,
        aa = sa / n;
      const filled = aa > 100 && dist2(ar, ag, ab, info.bg) > tol2;
      cells[r * cols + c] = filled ? [ar, ag, ab] : null;
    }
  }
  return { cols, rows, cells };
}

/** Dáng khối quyết định độ dày (theo trục Z) phân bố theo chiều cao. */
export type DepthProfile = 'box' | 'pyramid' | 'dome' | 'ellipse';

export const PROFILES: { id: DepthProfile; label: string }[] = [
  { id: 'box', label: '⬛ Hộp' },
  { id: 'pyramid', label: '🔺 Kim tự tháp' },
  { id: 'dome', label: '⛰ Vòm' },
  { id: 'ellipse', label: '🥚 Bầu dục' },
];

/**
 * Hệ số độ dày [0..1] theo chiều cao chuẩn hoá f (0 = chân, 1 = đỉnh).
 * Nhân với độ dày gốc để ra số lớp Z tại từng hàng.
 */
export function profileFactor(profile: DepthProfile, f: number): number {
  const t = Math.min(1, Math.max(0, f));
  switch (profile) {
    case 'box':
      return 1; // đều nhau
    case 'pyramid':
      return 1 - t; // thuôn tuyến tính về đỉnh
    case 'dome':
      return Math.sqrt(Math.max(0, 1 - t * t)); // cong tròn (1/4 đường tròn)
    case 'ellipse': {
      const u = 2 * t - 1; // -1..1
      return Math.sqrt(Math.max(0, 1 - u * u)); // phình giữa, thon 2 đầu
    }
  }
}

/** Số lớp Z (độ dày t) canh giữa quanh z=0: vd t=6 -> [-3..2], t=1 -> [0]. */
export function zLayers(t: number): number[] {
  const zs: number[] = [];
  const start = -Math.floor(t / 2);
  for (let k = 0; k < t; k++) zs.push(start + k);
  return zs;
}

/**
 * Lớp Z tại 1 hàng: coi như khối hộp ĐẶC (độ dày `thickness`) rồi GỌT đối xứng
 * quanh cùng một tâm theo hệ số f [0..1]. Nhờ dùng chung 1 tâm cho mọi hàng,
 * hai mặt trước/sau luôn soi gương nhau và các bậc giảm đều (mặt vát chéo),
 * không bị nhấp nhô như khi canh giữa từng hàng độc lập.
 */
export function rowZLayers(thickness: number, f: number): number[] {
  const full = zLayers(thickness);
  if (thickness <= 1) return full;
  const c = (full[0] + full[full.length - 1]) / 2; // tâm chung (có thể .5)
  const halfWidth = (thickness - 1) / 2;
  const minDist = full.length % 2 === 0 ? 0.5 : 0; // luôn giữ ≥ lớp giữa
  const allowed = Math.max(minDist, halfWidth * Math.min(1, Math.max(0, f)));
  return full.filter((z) => Math.abs(z - c) <= allowed + 1e-6);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Màu gần nhất trong palette (Euclid RGB). */
export function snapToPalette(rgb: [number, number, number], palette: string[]): string {
  let best = palette[0];
  let bestD = Infinity;
  for (const p of palette) {
    const [r, g, b] = hexToRgb(p);
    const d = dist2(rgb[0], rgb[1], rgb[2], [r, g, b]);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
