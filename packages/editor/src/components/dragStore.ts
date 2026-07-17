import { create } from 'zustand';
import type { Cell } from './Voxels';

/**
 * Kéo-thả tạo vùng khối:
 *  - Kéo thường: vùng chữ nhật NGANG (4 hướng trong mặt phẳng X/Z) ở tầng neo.
 *  - Giữ Ctrl trong lúc kéo: di chuột lên/xuống để nâng/hạ CHIỀU CAO của vùng.
 * Thả chuột thì fill; Esc huỷ.
 */
export type DragMode = 'place' | 'remove' | 'paint';

export interface DragState {
  mode: DragMode;
  baseY: number; // tầng của mặt đáy (theo ô neo)
  anchorX: number;
  anchorZ: number;
  curX: number;
  curZ: number;
  loY: number; // dải tầng hiện tại (Ctrl để thay đổi)
  hiY: number;
}

interface DragStore {
  drag: DragState | null;
  start: (d: DragState) => void;
  move: (x: number, z: number) => void;
  setLayers: (lo: number, hi: number) => void;
  clear: () => void;
}

export const useDrag = create<DragStore>((set) => ({
  drag: null,
  start: (d) => set({ drag: d }),
  move: (x, z) =>
    set((s) => (s.drag ? { drag: { ...s.drag, curX: x, curZ: z } } : s)),
  setLayers: (lo, hi) =>
    set((s) => (s.drag ? { drag: { ...s.drag, loY: lo, hiY: hi } } : s)),
  clear: () => set({ drag: null }),
}));

export const MAX_SIDE = 256; // chặn fill quá lớn gây treo

export function clampSpan(anchor: number, cur: number): [number, number] {
  let lo = Math.min(anchor, cur);
  let hi = Math.max(anchor, cur);
  if (hi - lo + 1 > MAX_SIDE) {
    if (cur >= anchor) hi = anchor + MAX_SIDE - 1;
    else lo = anchor - MAX_SIDE + 1;
  }
  return [lo, hi];
}

/** Danh sách ô trong vùng hiện tại (đáy ngang × dải tầng). */
export function regionCells(d: DragState): Cell[] {
  const [xMin, xMax] = clampSpan(d.anchorX, d.curX);
  const [zMin, zMax] = clampSpan(d.anchorZ, d.curZ);
  const yMin = Math.min(d.loY, d.hiY);
  const yMax = Math.max(d.loY, d.hiY);
  const cells: Cell[] = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      for (let z = zMin; z <= zMax; z++) {
        cells.push([x, y, z]);
      }
    }
  }
  return cells;
}

/** Kích thước/tâm hộp bao vùng (dùng cho preview). */
export function regionBox(d: DragState): { center: Cell; size: Cell } {
  const [xMin, xMax] = clampSpan(d.anchorX, d.curX);
  const [zMin, zMax] = clampSpan(d.anchorZ, d.curZ);
  const yMin = Math.min(d.loY, d.hiY);
  const yMax = Math.max(d.loY, d.hiY);
  return {
    center: [(xMin + xMax + 1) / 2, (yMin + yMax + 1) / 2, (zMin + zMax + 1) / 2],
    size: [xMax - xMin + 1, yMax - yMin + 1, zMax - zMin + 1],
  };
}

/** Bắt đầu kéo từ một mặt của khối đã có. */
export function beginDragFace(
  cell: Cell,
  normal: { x: number; y: number; z: number },
  mode: DragMode,
): void {
  if (useDrag.getState().drag) return;
  const rn = [Math.round(normal.x), Math.round(normal.y), Math.round(normal.z)];
  // Xóa/sơn nhắm vào chính khối; đặt nhắm vào ô áp mặt.
  const anchor: Cell =
    mode !== 'place' ? [...cell] : [cell[0] + rn[0], cell[1] + rn[1], cell[2] + rn[2]];
  useDrag.getState().start({
    mode,
    baseY: anchor[1],
    anchorX: anchor[0],
    anchorZ: anchor[2],
    curX: anchor[0],
    curZ: anchor[2],
    loY: anchor[1],
    hiY: anchor[1],
  });
}

/**
 * Bắt đầu kéo trên mặt sàn. `layerY`: camera ở trên sàn -> 0,
 * camera ở dưới -> -1 (đặt xuống dưới).
 */
export function beginDragGround(
  x: number,
  z: number,
  mode: DragMode,
  layerY = 0,
): void {
  if (useDrag.getState().drag) return;
  useDrag.getState().start({
    mode,
    baseY: layerY,
    anchorX: x,
    anchorZ: z,
    curX: x,
    curZ: z,
    loY: layerY,
    hiY: layerY,
  });
}
