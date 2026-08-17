import { create } from 'zustand';
import type { Cell } from './Voxels';

/**
 * Kéo-thả tạo vùng khối:
 *  - Kéo thường: vùng chữ nhật NGANG (4 hướng trong mặt phẳng X/Y) ở tầng neo.
 *  - Giữ Ctrl trong lúc kéo: di chuột lên/xuống để nâng/hạ CHIỀU CAO của vùng.
 * Thả chuột thì fill; Esc huỷ.
 *
 * Trục đứng là Z (trùng hệ trục của LevelData), nên "tầng" ở đây là z chứ không phải y.
 */
export type DragMode = 'place' | 'remove' | 'paint' | 'select';

export interface DragState {
  mode: DragMode;
  baseZ: number; // tầng của mặt đáy (theo ô neo)
  anchorX: number;
  anchorY: number;
  curX: number;
  curY: number;
  loZ: number; // dải tầng hiện tại (Ctrl để thay đổi)
  hiZ: number;
}

interface DragStore {
  drag: DragState | null;
  start: (d: DragState) => void;
  move: (x: number, y: number) => void;
  setLayers: (lo: number, hi: number) => void;
  clear: () => void;
}

export const useDrag = create<DragStore>((set) => ({
  drag: null,
  start: (d) => set({ drag: d }),
  move: (x, y) =>
    set((s) => (s.drag ? { drag: { ...s.drag, curX: x, curY: y } } : s)),
  setLayers: (lo, hi) =>
    set((s) => (s.drag ? { drag: { ...s.drag, loZ: lo, hiZ: hi } } : s)),
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
  const [yMin, yMax] = clampSpan(d.anchorY, d.curY);
  const zMin = Math.min(d.loZ, d.hiZ);
  const zMax = Math.max(d.loZ, d.hiZ);
  const cells: Cell[] = [];
  for (let z = zMin; z <= zMax; z++) {
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        cells.push([x, y, z]);
      }
    }
  }
  return cells;
}

/** Hai góc (đều tính vào vùng) của vùng đang kéo. */
export function dragBounds(d: DragState): { min: Cell; max: Cell } {
  const [xMin, xMax] = clampSpan(d.anchorX, d.curX);
  const [yMin, yMax] = clampSpan(d.anchorY, d.curY);
  return {
    min: [xMin, yMin, Math.min(d.loZ, d.hiZ)],
    max: [xMax, yMax, Math.max(d.loZ, d.hiZ)],
  };
}

/** Kích thước/tâm hộp bao vùng (dùng cho preview). */
export function regionBox(d: DragState): { center: Cell; size: Cell } {
  const [xMin, xMax] = clampSpan(d.anchorX, d.curX);
  const [yMin, yMax] = clampSpan(d.anchorY, d.curY);
  const zMin = Math.min(d.loZ, d.hiZ);
  const zMax = Math.max(d.loZ, d.hiZ);
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
    baseZ: anchor[2],
    anchorX: anchor[0],
    anchorY: anchor[1],
    curX: anchor[0],
    curY: anchor[1],
    loZ: anchor[2],
    hiZ: anchor[2],
  });
}

/**
 * Bắt đầu kéo trên mặt sàn. `layerZ`: camera ở trên sàn -> 0,
 * camera ở dưới -> -1 (đặt xuống dưới).
 */
export function beginDragGround(
  x: number,
  y: number,
  mode: DragMode,
  layerZ = 0,
): void {
  if (useDrag.getState().drag) return;
  useDrag.getState().start({
    mode,
    baseZ: layerZ,
    anchorX: x,
    anchorY: y,
    curX: x,
    curY: y,
    loZ: layerZ,
    hiZ: layerZ,
  });
}
