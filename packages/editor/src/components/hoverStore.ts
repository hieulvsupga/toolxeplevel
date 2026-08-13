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
 * Cũng khác `hover` trong EditorScene: chỗ đó là ô ĐÍCH của thao tác (ở chế độ đặt thì nó là ô
 * trống áp mặt), còn đây là chính khối đang bị trỏ vào.
 */
export const useHoverBlock = create<HoverStore>((set) => ({
  block: null,
  setBlock: (block) => set((s) => (same(s.block, block) ? s : { block })),
}));
