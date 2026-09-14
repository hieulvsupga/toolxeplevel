import { create } from 'zustand';
import { visibleCellFilter } from '../lib/useLayers';
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

/**
 * Vùng chọn 2D: một TẬP Ô cụ thể (kéo khung trên màn hình rồi lấy các khối rơi vào khung), khác hộp
 * 3D ở chỗ nó rời rạc — hộp bao `region` kèm đây chỉ để dán / nhân bản / vẽ khung, không phải nội
 * dung vùng chọn.
 */
export interface Pick {
  cells: Cell[];
  region: Region;
}

interface SelectionStore {
  region: Region | null;
  /** Vùng chọn 2D. Chỉ một trong hai (`region` / `pick`) có hiệu lực — xem `setRegion`/`setPick`. */
  pick: Pick | null;
  /** Cụm đã copy, giữ nguyên qua các lần đổi vùng chọn để dán được nhiều lần. */
  clip: Clip | null;
  setRegion: (r: Region | null) => void;
  setPick: (p: Pick | null) => void;
  /** Dời hộp chọn / tập ô đã chọn theo cùng khoảng đã dời khối, để chọn tiếp mà không phải kéo lại. */
  shiftRegion: (dx: number, dy: number, dz: number) => void;
  setClip: (c: Clip | null) => void;
}

const shifted = (r: Region, dx: number, dy: number, dz: number): Region => ({
  min: [r.min[0] + dx, r.min[1] + dy, r.min[2] + dz],
  max: [r.max[0] + dx, r.max[1] + dy, r.max[2] + dz],
});

export const useSelection = create<SelectionStore>((set) => ({
  region: null,
  pick: null,
  clip: null,
  // Hai kiểu chọn loại nhau: để cả hai cùng sống thì mọi thao tác phải đoán xem người dùng đang
  // nói tới cái nào.
  setRegion: (region) => set({ region, pick: null }),
  setPick: (pick) => set({ pick, region: null }),
  shiftRegion: (dx, dy, dz) =>
    set((s) => {
      if (s.pick) {
        return {
          pick: {
            cells: s.pick.cells.map(([x, y, z]) => [x + dx, y + dy, z + dz] as Cell),
            region: shifted(s.pick.region, dx, dy, dz),
          },
        };
      }
      return s.region ? { region: shifted(s.region, dx, dy, dz) } : s;
    }),
  setClip: (clip) => set({ clip }),
}));

/** Hộp bao của một tập ô -> `Pick`. Tập rỗng thì trả null (không có gì để chọn). */
export function pickFromCells(cells: Cell[]): Pick | null {
  if (!cells.length) return null;
  const min: Cell = [...cells[0]];
  const max: Cell = [...cells[0]];
  for (const [x, y, z] of cells) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { cells, region: { min, max } };
}

/**
 * Các ô của vùng chọn 2D còn THẬT SỰ dùng được: vẫn có khối và đang hiện.
 *
 * Tập ô được chốt lúc kéo khung, mà sau đó người dùng còn xoá khối, tắt layer, lọc màu — thao tác
 * sau phải chạy trên phần còn hợp lệ, không thì dời/xoá cả những ô giờ đã trống hoặc đang bị ẩn.
 */
export function livePickCells(p: Pick): Cell[] {
  const grid = useEditor.getState().grid;
  const visible = visibleCellFilter();
  return p.cells.filter(([x, y, z]) => grid.has(x, y, z) && visible(x, y, z));
}

/**
 * Nới / co VÙNG CHỌN 2D một hàng theo một trục — trả về tập ô mới.
 *
 * Vùng chọn 2D là một tập ô rời chứ không phải hộp, nên "nới" không phải là kéo hộp bao ra mà là
 * THÊM các khối ở hàng kế tiếp vào tập đang chọn; "co" là bỏ các ô nằm ở hàng ngoài cùng. Nhờ vậy
 * hàng Cỡ khung dùng được cho cả hai kiểu chọn, thay vì xám đi ở đúng chế độ cần nó nhất.
 *
 * `dir` +1 = nới, −1 = co. `atMin` = làm ở phía nhỏ của trục thay vì phía lớn.
 */
export function resizePickCells(p: Pick, axis: 0 | 1 | 2, dir: -1 | 1, atMin: boolean): Cell[] {
  const cells = livePickCells(p);
  if (!cells.length) return cells;

  // Hộp bao tính lại từ các ô CÒN dùng được, không lấy `p.region` cũ: khối trong vùng có thể đã bị
  // xoá hay bị ẩn từ lúc chọn, lấy hộp cũ thì nới vào một hàng chẳng dính khối nào.
  const min = [...cells[0]] as Cell;
  const max = [...cells[0]] as Cell;
  for (const c of cells) {
    for (let i = 0; i < 3; i++) {
      if (c[i] < min[i]) min[i] = c[i];
      if (c[i] > max[i]) max[i] = c[i];
    }
  }

  const edge = atMin ? min[axis] : max[axis];
  if (dir === -1) {
    const kept = cells.filter((c) => c[axis] !== edge);
    // Co hết sạch thì giữ nguyên: bỏ chọn nên là việc của nút Bỏ chọn / Esc, không phải của nút co.
    return kept.length ? kept : cells;
  }

  // Nới: quét đúng LÁT ô kế tiếp, trong phạm vi hộp bao theo hai trục còn lại.
  const grid = useEditor.getState().grid;
  const visible = visibleCellFilter();
  const at = atMin ? edge - 1 : edge + 1;
  const lo: Cell = [...min];
  const hi: Cell = [...max];
  lo[axis] = at;
  hi[axis] = at;
  const added: Cell[] = [];
  for (let x = lo[0]; x <= hi[0]; x++) {
    for (let y = lo[1]; y <= hi[1]; y++) {
      for (let z = lo[2]; z <= hi[2]; z++) {
        if (grid.has(x, y, z) && visible(x, y, z)) added.push([x, y, z]);
      }
    }
  }
  return added.length ? [...cells, ...added] : cells;
}

/** Copy một tập ô ra clipboard, toạ độ tương đối so với `min` (góc hộp bao). */
export function copyCells(cells: Cell[], min: Cell, size: Cell): Clip | null {
  const grid = useEditor.getState().grid;
  const items: RelVoxel[] = [];
  for (const [x, y, z] of cells) {
    const voxel = grid.get(x, y, z);
    if (!voxel) continue;
    items.push({ dx: x - min[0], dy: y - min[1], dz: z - min[2], voxel: { ...voxel } });
  }
  return items.length ? { items, size } : null;
}

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
  const visible = visibleCellFilter();
  const out: Cell[] = [];
  for (const [x, y, z] of regionCells(r)) {
    // Khối đang bị ẩn (tắt layer / bộ lọc màu) không tính vào vùng chọn: dời hay xoá một thứ
    // không nhìn thấy là sửa data mà không ai biết.
    if (grid.has(x, y, z) && visible(x, y, z)) out.push([x, y, z]);
  }
  return out;
}

export function countFilled(r: Region): number {
  const grid = useEditor.getState().grid;
  const visible = visibleCellFilter();
  let n = 0;
  for (let z = r.min[2]; z <= r.max[2]; z++) {
    for (let y = r.min[1]; y <= r.max[1]; y++) {
      for (let x = r.min[0]; x <= r.max[0]; x++) {
        // Đếm đúng số khối mà các thao tác sẽ chạm tới, tức chỉ khối đang thấy.
        if (grid.has(x, y, z) && visible(x, y, z)) n++;
      }
    }
  }
  return n;
}

/** Copy nội dung vùng chọn ra clipboard (toạ độ tương đối so với góc min). */
export function copyRegion(r: Region): Clip | null {
  const grid = useEditor.getState().grid;
  const items: RelVoxel[] = [];
  const visible = visibleCellFilter();
  for (const [x, y, z] of regionCells(r)) {
    const voxel = grid.get(x, y, z);
    if (!voxel || !visible(x, y, z)) continue;
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
