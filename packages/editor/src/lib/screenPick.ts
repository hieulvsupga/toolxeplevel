/**
 * Chọn khối bằng một khung kéo trên MÀN HÌNH (chọn 2D).
 *
 * Khác hẳn vùng chọn 3D: vùng chọn 3D là một hộp trong không gian, còn chọn 2D chiếu từng khối lên
 * màn hình rồi lấy những khối rơi vào khung — kết quả là một TẬP Ô rời rạc, không phải hộp.
 *
 * Phần chiếu toạ độ để chỗ gọi truyền vào (`toScreen`), nên hàm này không cần biết tới camera và
 * kiểm được bằng test.
 */
import type { Cell } from '../components/Voxels';

/** Khung chọn theo pixel của canvas (gốc ở góc trên-trái). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Vị trí một khối trên màn hình. `inFront` = false nghĩa là nằm sau camera / ngoài tầm nhìn. */
export interface ScreenPos {
  x: number;
  y: number;
  inFront: boolean;
}

/** Chuẩn hoá hai đầu của cú kéo thành khung có x0 ≤ x1, y0 ≤ y1. */
export function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): ScreenRect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** Khung nhỏ hơn mức này (px) coi như một cú BẤM chứ không phải kéo chọn. */
export const CLICK_SLOP = 3;

export function isClick(rect: ScreenRect): boolean {
  return rect.x1 - rect.x0 < CLICK_SLOP && rect.y1 - rect.y0 < CLICK_SLOP;
}

/**
 * Các ô có khối mà TÂM khối chiếu vào trong khung.
 *
 * Lấy tâm khối chứ không phải cả 8 đỉnh: lấy đỉnh thì khối chỉ chớm mép khung cũng bị chọn, quét
 * một đường là dính cả hàng bên cạnh. Tâm nằm trong khung = "khối này ở trong vùng tôi khoanh".
 *
 * KHÔNG xét che khuất: khối bị khối khác che vẫn được chọn nếu tâm nó nằm trong khung. Khoanh một
 * vùng trên khối đặc là chọn xuyên hết chiều sâu của vùng đó — đúng thứ cần khi muốn bốc cả một
 * mảng, còn muốn lấy riêng lớp vỏ thì tắt các layer trong đi rồi khoanh (khối đang ẩn bị `keep`
 * loại ra).
 */
export function cellsInScreenRect(
  cells: Iterable<{ x: number; y: number; z: number }>,
  rect: ScreenRect,
  toScreen: (x: number, y: number, z: number) => ScreenPos,
  keep?: (x: number, y: number, z: number) => boolean,
): Cell[] {
  const out: Cell[] = [];
  for (const { x, y, z } of cells) {
    if (keep && !keep(x, y, z)) continue;
    const p = toScreen(x, y, z);
    if (!p.inFront) continue;
    if (p.x < rect.x0 || p.x > rect.x1 || p.y < rect.y0 || p.y > rect.y1) continue;
    out.push([x, y, z]);
  }
  return out;
}

/** Gộp hai tập ô, bỏ trùng (giữ thứ tự: tập cũ trước, ô mới thêm sau). */
export function mergeCells(a: Cell[], b: Cell[]): Cell[] {
  const seen = new Set(a.map(([x, y, z]) => `${x},${y},${z}`));
  const out = [...a];
  for (const c of b) {
    const k = `${c[0]},${c[1]},${c[2]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
