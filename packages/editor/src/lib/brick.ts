/**
 * Hình gạch dùng chung cho khối TƯỜNG: ô trong lưới 2D (12–18px) và vân dán lên khối 3D (128px).
 *
 * Một hàm vẽ duy nhất cho cả hai để chúng không bao giờ lệch nhau — người dựng level tô ô gạch nào
 * trên lưới thì thấy đúng viên gạch đó hiện ra trong scene.
 *
 * Màu lấy theo viên gạch 🧱 quen thuộc: gạch đỏ nâu, mạch vữa xám sáng.
 */

export const BRICK_MORTAR = '#d9d2c7';

/** Vài sắc đỏ cho các viên gạch, xen kẽ nhau cho đỡ phẳng. */
export const BRICK_FACES = ['#a8402d', '#b9503a', '#963726', '#c25c43', '#9d3a28'];

/** Nền của một khối tường trong lưới 2D (chỗ mạch vữa hở ra). */
export const BRICK_BASE = BRICK_MORTAR;

/** Chọn màu gạch theo vị trí viên — cùng một viên thì lần vẽ nào cũng ra một màu. */
function faceColor(row: number, col: number, salt: number): string {
  const h = Math.abs(Math.imul(row + 1, 73856093) ^ Math.imul(col + 3, 19349663) ^ salt);
  return BRICK_FACES[h % BRICK_FACES.length];
}

export interface BrickOptions {
  /** Số hàng gạch trong một ô. */
  rows?: number;
  /** Vẽ thành thang xám cho bump map (gạch nổi, mạch lõm) thay vì vẽ màu. */
  mono?: boolean;
  /** Đổi hạt giống để hai ô cạnh nhau không trùng hệt kiểu màu. */
  salt?: number;
}

/**
 * Vẽ một mảng gạch xếp so le lấp kín ô vuông (x, y, size).
 *
 * Hàng chẵn bắt đầu bằng viên nguyên, hàng lẻ lùi nửa viên — chính chỗ so le đó làm mắt đọc ra
 * "tường gạch" chứ không phải "lưới ô vuông".
 */
export function drawBricks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  { rows = 3, mono = false, salt = 0 }: BrickOptions = {},
): void {
  const h = size / rows;
  const w = size / 2; // 2 viên mỗi hàng
  const gap = Math.max(0.75, size / 22); // bề dày mạch vữa

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  ctx.fillStyle = mono ? '#4a4a4a' : BRICK_MORTAR;
  ctx.fillRect(x, y, size, size);

  for (let r = 0; r < rows; r++) {
    const shift = r % 2 === 0 ? 0 : -w / 2;
    // Vẽ dư một viên mỗi bên để hàng lệch vẫn kín mép ô.
    for (let c = -1; c <= 2; c++) {
      const bx = x + shift + c * w;
      const by = y + r * h;
      ctx.fillStyle = mono ? '#d2d2d2' : faceColor(r, c, salt);
      ctx.fillRect(bx + gap / 2, by + gap / 2, w - gap, h - gap);
    }
  }
  ctx.restore();
}
