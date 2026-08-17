import { WALL_HEX } from '@voxel/core';
import { drawBricks } from './brick';

/**
 * Vẽ một ô của lưới 2D.
 *
 * Ô TƯỜNG vẽ thành gạch đỏ xếp so le thay vì một mảng màu trơn: tường là cơ chế (khối không bắn
 * được) chứ không phải một màu để tô, mà hex của nó lại là sắc xám rất dễ lẫn với các màu xám khác
 * trong bảng màu. Ở một ô 12–18px thì không nhét được chữ, nên hình gạch là cách duy nhất phân biệt
 * ngay trên lưới — và cũng đúng thứ hiện ra trong scene 3D.
 */
export function fillGridCell(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  color: string,
): void {
  if (color === WALL_HEX) {
    drawBricks(ctx, px, py, size);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(px, py, size, size);
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
}
