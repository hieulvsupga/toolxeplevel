/**
 * Bảng màu của game — mỗi ô ứng với đúng 1 `ColorType` bên Unity.
 *
 * Đây là bản sao của `Assets/_Project/Data/Palette/ColorPaletteData.asset`. Giá trị hex phải
 * khớp với `color` trong asset đó: shooter tô màu phẳng bằng đúng giá trị này, còn voxel lấy màu
 * từ atlas — lệch nhau là người chơi thấy 2 màu khác nhau ở thứ đáng lẽ phải khớp.
 */
export interface GameColor {
  /** Giá trị enum `ColorType` bên Unity. */
  id: number;
  name: string;
  hex: string;
}

/**
 * `ColorType.None` — voxel tường: vật cản vĩnh viễn, không bao giờ là mục tiêu bắn và không tính
 * vào điều kiện phá xong màn. Đây là *sentinel*, không phải màu render được, nên hex dưới đây chỉ
 * để hiển thị trong editor chứ không tồn tại trong palette của game.
 */
export const WALL_COLOR_ID = 0;
export const WALL_HEX = '#8A8F98';

export const GAME_COLORS: GameColor[] = [
  { id: WALL_COLOR_ID, name: 'Tường', hex: WALL_HEX },
  { id: 1, name: 'Magenta', hex: '#CC51E3' },
  { id: 2, name: 'Red', hex: '#D12F2F' },
  { id: 3, name: 'Yellow', hex: '#E8B40D' },
  { id: 4, name: 'White', hex: '#FFFFFF' },
  { id: 5, name: 'Orange', hex: '#EB6A17' },
  { id: 6, name: 'Pink', hex: '#EB89B2' },
  { id: 7, name: 'Purple', hex: '#8A5ADE' },
  { id: 8, name: 'Lilac', hex: '#BD96EA' },
  { id: 9, name: 'Blue', hex: '#576FD8' },
  { id: 10, name: 'Brown', hex: '#AE5E3C' },
  { id: 11, name: 'Green', hex: '#62AF00' },
  { id: 12, name: 'DarkGreen', hex: '#008655' },
  { id: 13, name: 'Beige', hex: '#DFB378' },
  { id: 14, name: 'DarkGray', hex: '#4B475A' },
  { id: 15, name: 'SkyBlue', hex: '#33AFE9' },
  { id: 16, name: 'Turquoise', hex: '#07BABC' },
];

/** Các hex dùng làm bảng màu mặc định của editor (kể cả ô tường). */
export const GAME_PALETTE: string[] = GAME_COLORS.map((c) => c.hex);

const byHex = new Map(GAME_COLORS.map((c) => [c.hex.toUpperCase(), c]));

export function gameColorByHex(hex: string): GameColor | undefined {
  return byHex.get(hex.toUpperCase());
}

export function gameColorById(id: number): GameColor | undefined {
  return GAME_COLORS.find((c) => c.id === id);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// sRGB -> linear -> CIE XYZ (D65) -> CIE Lab. Khớp đúng cách `SourceColorMapper` bên Unity đo màu:
// khoảng cách Euclid trong Lab xấp xỉ khoảng cách mắt người thấy, còn khoảng cách RGB thô thì
// đánh giá sai nặng ở màu bão hoà (xanh lá đậm và xanh dương đậm có thể "gần" nhau hơn cả cặp màu
// trông rõ ràng giống nhau).
function toLab(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin(r8);
  const g = lin(g8);
  const b = lin(b8);

  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;

  const pivot = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const labCache = new Map<string, [number, number, number]>();
function labOf(hex: string): [number, number, number] {
  const key = hex.toUpperCase();
  let lab = labCache.get(key);
  if (!lab) {
    lab = toLab(key);
    labCache.set(key, lab);
  }
  return lab;
}

export interface ColorMatch {
  color: GameColor;
  /** false = hex không có trong bảng màu game, đã phải dò màu gần nhất. */
  exact: boolean;
}

/**
 * Hex của 1 voxel -> `ColorType`. Khớp chính xác là đường đi bình thường (bảng màu editor chính
 * là bảng màu game). Fallback dò màu gần nhất chỉ để cứu các level cũ vẽ bằng bảng màu ngẫu
 * nhiên đời trước — chỗ gọi nên báo cho người dùng biết khi `exact` là false, vì lúc đó 2 màu
 * khác nhau hoàn toàn có thể bị gộp về cùng một `ColorType`.
 */
export function matchGameColor(hex: string): ColorMatch {
  const exact = gameColorByHex(hex);
  if (exact) return { color: exact, exact: true };

  // Ô tường bị loại khỏi việc dò: nó là sentinel, không phải màu — một voxel xám lỡ khớp vào đó
  // sẽ lặng lẽ biến thành vật cản không bắn được thay vì thành một mục tiêu màu xám.
  const target = labOf(hex);
  let best = GAME_COLORS[1];
  let bestDistance = Infinity;
  for (const candidate of GAME_COLORS) {
    if (candidate.id === WALL_COLOR_ID) continue;
    const lab = labOf(candidate.hex);
    const distance =
      (lab[0] - target[0]) ** 2 + (lab[1] - target[1]) ** 2 + (lab[2] - target[2]) ** 2;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = candidate;
  }
  return { color: best, exact: false };
}
