import { create } from 'zustand';
import { useEditor, type RelVoxel } from '../store';
import type { Cell } from './Voxels';

/** Hộp chọn, hai góc đều TÍNH VÀO vùng (inclusive) để size = max - min + 1. */
export interface Region {
  min: Cell;
  max: Cell;
}

export interface Clip {
  items: RelVoxel[];
  size: Cell;
}

interface SelectionStore {
  region: Region | null;
  /** Cụm đã copy, giữ nguyên qua các lần đổi vùng chọn để dán được nhiều lần. */
  clip: Clip | null;
  setRegion: (r: Region | null) => void;
  /** Dời hộp chọn theo cùng khoảng đã dời khối, để chọn tiếp mà không phải kéo lại. */
  shiftRegion: (dx: number, dy: number, dz: number) => void;
  setClip: (c: Clip | null) => void;
}

export const useSelection = create<SelectionStore>((set) => ({
  region: null,
  clip: null,
  setRegion: (region) => set({ region }),
  shiftRegion: (dx, dy, dz) =>
    set((s) =>
      s.region
        ? {
            region: {
              min: [s.region.min[0] + dx, s.region.min[1] + dy, s.region.min[2] + dz],
              max: [s.region.max[0] + dx, s.region.max[1] + dy, s.region.max[2] + dz],
            },
          }
        : s,
    ),
  setClip: (clip) => set({ clip }),
}));

export function regionSize(r: Region): Cell {
  return [r.max[0] - r.min[0] + 1, r.max[1] - r.min[1] + 1, r.max[2] - r.min[2] + 1];
}

/** Tâm hộp chọn theo toạ độ thế giới (ô [x] chiếm khoảng x..x+1). */
export function regionCenter(r: Region): Cell {
  const [sx, sy, sz] = regionSize(r);
  return [r.min[0] + sx / 2, r.min[1] + sy / 2, r.min[2] + sz / 2];
}

export function regionCells(r: Region): Cell[] {
  const cells: Cell[] = [];
  for (let z = r.min[2]; z <= r.max[2]; z++) {
    for (let y = r.min[1]; y <= r.max[1]; y++) {
      for (let x = r.min[0]; x <= r.max[0]; x++) {
        cells.push([x, y, z]);
      }
    }
  }
  return cells;
}

/**
 * Các ô CÓ khối trong vùng chọn. Dùng cho mọi thao tác (dời/copy/xoá) thay vì
 * duyệt cả hộp: hộp cao 20 tầng mà chỉ có 5 khối thì chỉ xử lý 5 ô.
 */
export function filledCells(r: Region): Cell[] {
  const grid = useEditor.getState().grid;
  const out: Cell[] = [];
  for (const [x, y, z] of regionCells(r)) {
    if (grid.has(x, y, z)) out.push([x, y, z]);
  }
  return out;
}

export function countFilled(r: Region): number {
  const grid = useEditor.getState().grid;
  let n = 0;
  for (let z = r.min[2]; z <= r.max[2]; z++) {
    for (let y = r.min[1]; y <= r.max[1]; y++) {
      for (let x = r.min[0]; x <= r.max[0]; x++) {
        if (grid.has(x, y, z)) n++;
      }
    }
  }
  return n;
}

/** Copy nội dung vùng chọn ra clipboard (toạ độ tương đối so với góc min). */
export function copyRegion(r: Region): Clip | null {
  const grid = useEditor.getState().grid;
  const items: RelVoxel[] = [];
  for (const [x, y, z] of regionCells(r)) {
    const voxel = grid.get(x, y, z);
    if (!voxel) continue;
    items.push({ dx: x - r.min[0], dy: y - r.min[1], dz: z - r.min[2], voxel: { ...voxel } });
  }
  if (!items.length) return null;
  return { items, size: regionSize(r) };
}

/** Hộp chọn bao đúng một cụm voxel đã dán tại `at`. */
export function clipRegionAt(clip: Clip, at: Cell): Region {
  return {
    min: [...at] as Cell,
    max: [at[0] + clip.size[0] - 1, at[1] + clip.size[1] - 1, at[2] + clip.size[2] - 1],
  };
}
