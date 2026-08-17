import { create } from 'zustand';
import type { Cell } from './Voxels';

export interface HoveredBlock {
  cell: Cell;
  color: string;
}

interface HoverStore {
  /** Khối chuột đang trỏ vào, hoặc null khi không trỏ vào khối nào. */
  block: HoveredBlock | null;
  setBlock: (block: HoveredBlock | null) => void;
  /**
   * Ô ĐÍCH của thao tác (ở chế độ đặt là ô trống áp mặt). Cùng giá trị mà
   * HoverPreview vẽ khung, để phần dán cụm khối biết dán vào đâu.
   */
  target: Cell | null;
  setTarget: (cell: Cell | null) => void;
}

function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function same(a: HoveredBlock | null, b: HoveredBlock | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.cell[0] === b.cell[0] &&
    a.cell[1] === b.cell[1] &&
    a.cell[2] === b.cell[2] &&
    a.color === b.color
  );
}

/**
 * Store riêng, tách khỏi `useEditor`: pointermove bắn liên tục theo từng pixel, nên gộp vào store
 * chính là mỗi lần rê chuột lại render lại toàn bộ scene. Ở đây chỉ HUD toạ độ subscribe.
 *
 * `block` là chính khối đang bị trỏ vào, `target` là ô đích của thao tác — ở chế độ đặt hai cái
 * khác nhau (đích là ô trống áp mặt).
 */
export const useHoverBlock = create<HoverStore>((set) => ({
  block: null,
  setBlock: (block) => set((s) => (same(s.block, block) ? s : { block })),
  target: null,
  setTarget: (target) => set((s) => (sameCell(s.target, target) ? s : { target })),
}));
