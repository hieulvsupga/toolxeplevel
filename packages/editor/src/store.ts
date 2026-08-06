import { create } from 'zustand';
import { VoxelGrid, fromJSON, toJSON, type Voxel } from '@voxel/core';

export type ToolMode = 'place' | 'remove' | 'paint';

type Cell = [number, number, number];

/** 1 thay đổi trên 1 ô — before/after = undefined nghĩa là ô trống. */
interface Change {
  x: number;
  y: number;
  z: number;
  before?: Voxel;
  after?: Voxel;
}

/** Một thao tác = 1 nhóm thay đổi (fill cả vùng cũng chỉ 1 lần undo). */
type Batch = Change[];

const AUTOSAVE_KEY = 'voxel-level-autosave';
const PALETTE_KEY = 'voxel-palette';

/** HSL -> hex (#rrggbb). h: 0-360, s/l: 0-1. */
function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** 1 màu ngẫu nhiên tươi (độ bão hoà/sáng vừa mắt). */
export function randomColor(): string {
  return hslHex(Math.floor(Math.random() * 360), 0.62, 0.54);
}

function randomPalette(n = 10): string[] {
  return Array.from({ length: n }, () => randomColor());
}

function loadPalette(): string[] {
  try {
    const raw = localStorage.getItem(PALETTE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {
    // hỏng -> dùng bảng ngẫu nhiên
  }
  return randomPalette();
}

const initialPalette = loadPalette();

interface EditorState {
  grid: VoxelGrid;
  /** Tăng mỗi khi grid đổi để component render lại (grid là mutable ref). */
  version: number;
  color: string;
  palette: string[];
  mode: ToolMode;
  mirrorX: boolean;
  mirrorZ: boolean;
  /** Lọc hiển thị theo màu. Rỗng = hiện tất cả; có phần tử = chỉ hiện các màu này. */
  colorFilter: string[];
  undoStack: Batch[];
  redoStack: Batch[];

  setColor: (color: string) => void;
  toggleColorFilter: (color: string) => void;
  clearColorFilter: () => void;
  addPaletteColor: () => void;
  setPaletteColor: (index: number, color: string) => void;
  removePaletteColor: (index: number) => void;
  setMode: (mode: ToolMode) => void;
  toggleMirror: (axis: 'x' | 'z') => void;

  /** Đặt (voxel) hoặc xóa (null) một loạt ô, gộp thành 1 undo. */
  fill: (cells: Cell[], voxel: Voxel | null) => void;
  /** Sơn lại màu các ô ĐÃ CÓ khối trong danh sách (không thêm/xóa). */
  paint: (cells: Cell[], color: string) => void;
  /** Như paint nhưng KHÔNG áp đối xứng — dùng cho tô màu theo tầng. */
  recolorCells: (cells: Cell[], color: string) => void;
  /** Xóa các ô (không mirror), gộp 1 undo — dùng cho tô màu theo tầng. */
  deleteCells: (cells: Cell[]) => void;
  place: (x: number, y: number, z: number) => void;
  remove: (x: number, y: number, z: number) => void;
  /** Dán một loạt voxel nhiều màu (dùng cho import ảnh) — gộp 1 undo. */
  stampVoxels: (items: { x: number; y: number; z: number; color: string }[]) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;

  exportJSON: () => string;
  importJSON: (json: string) => void;
}

function applyChange(grid: VoxelGrid, ch: Change, voxel: Voxel | undefined) {
  if (voxel) grid.set(ch.x, ch.y, ch.z, voxel);
  else grid.delete(ch.x, ch.y, ch.z);
}

/** Nhân bản ô qua mặt đối xứng x=0 / z=0 (ô x -> -1-x) nếu mirror đang bật. */
function expandMirror(cells: Cell[], mx: boolean, mz: boolean): Cell[] {
  if (!mx && !mz) return cells;
  const out = new Map<string, Cell>();
  const add = (c: Cell) => out.set(`${c[0]},${c[1]},${c[2]}`, c);
  for (const [x, y, z] of cells) {
    add([x, y, z]);
    if (mx) add([-1 - x, y, z]);
    if (mz) add([x, y, -1 - z]);
    if (mx && mz) add([-1 - x, y, -1 - z]);
  }
  return [...out.values()];
}

export const useEditor = create<EditorState>((set, get) => ({
  grid: new VoxelGrid(),
  version: 0,
  color: initialPalette[0],
  palette: initialPalette,
  mode: 'place',
  mirrorX: false,
  mirrorZ: false,
  colorFilter: [],
  undoStack: [],
  redoStack: [],

  setColor: (color) => set({ color }),

  toggleColorFilter: (color) =>
    set((s) => ({
      colorFilter: s.colorFilter.includes(color)
        ? s.colorFilter.filter((c) => c !== color)
        : [...s.colorFilter, color],
    })),
  clearColorFilter: () => set({ colorFilter: [] }),

  addPaletteColor: () => set((s) => ({ palette: [...s.palette, randomColor()] })),

  setPaletteColor: (index, color) =>
    set((s) => {
      const palette = s.palette.map((c, i) => (i === index ? color : c));
      // Nếu đang chọn đúng màu này thì cập nhật màu hiện tại theo.
      return { palette, color: s.color === s.palette[index] ? color : s.color };
    }),

  removePaletteColor: (index) =>
    set((s) => {
      if (s.palette.length <= 1) return s; // giữ tối thiểu 1 màu
      const removed = s.palette[index];
      const palette = s.palette.filter((_, i) => i !== index);
      return { palette, color: s.color === removed ? palette[0] : s.color };
    }),

  setMode: (mode) => set({ mode }),
  toggleMirror: (axis) =>
    set((s) => (axis === 'x' ? { mirrorX: !s.mirrorX } : { mirrorZ: !s.mirrorZ })),

  fill: (cells, voxel) => {
    const { grid, undoStack, mirrorX, mirrorZ } = get();
    const changes: Batch = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorZ)) {
      const before = grid.get(x, y, z);
      const after = voxel ? { ...voxel } : undefined;
      // Bỏ qua no-op.
      if (!after && !before) continue;
      if (after && before && before.color === after.color && before.type === after.type) {
        continue;
      }
      applyChange(grid, { x, y, z }, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({
      version: get().version + 1,
      undoStack: [...undoStack, changes],
      redoStack: [],
    });
  },

  paint: (cells, color) => {
    const { grid, undoStack, mirrorX, mirrorZ } = get();
    const changes: Batch = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorZ)) {
      const before = grid.get(x, y, z);
      if (!before || before.color === color) continue;
      const after: Voxel = { ...before, color };
      grid.set(x, y, z, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({
      version: get().version + 1,
      undoStack: [...undoStack, changes],
      redoStack: [],
    });
  },

  recolorCells: (cells, color) => {
    const { grid, undoStack } = get();
    const changes: Batch = [];
    for (const [x, y, z] of cells) {
      const before = grid.get(x, y, z);
      if (!before || before.color === color) continue;
      const after: Voxel = { ...before, color };
      grid.set(x, y, z, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, changes], redoStack: [] });
  },

  deleteCells: (cells) => {
    const { grid, undoStack } = get();
    const changes: Batch = [];
    for (const [x, y, z] of cells) {
      const before = grid.get(x, y, z);
      if (!before) continue;
      grid.delete(x, y, z);
      changes.push({ x, y, z, before, after: undefined });
    }
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, changes], redoStack: [] });
  },

  place: (x, y, z) => get().fill([[x, y, z]], { color: get().color }),
  remove: (x, y, z) => get().fill([[x, y, z]], null),

  stampVoxels: (items) => {
    const { grid, undoStack } = get();
    const changes: Batch = [];
    for (const { x, y, z, color } of items) {
      const before = grid.get(x, y, z);
      if (before && before.color === color) continue;
      const after: Voxel = { color };
      grid.set(x, y, z, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({
      version: get().version + 1,
      undoStack: [...undoStack, changes],
      redoStack: [],
    });
  },

  undo: () => {
    const { grid, undoStack, redoStack } = get();
    const batch = undoStack[undoStack.length - 1];
    if (!batch) return;
    for (const ch of batch) applyChange(grid, ch, ch.before);
    set({
      version: get().version + 1,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, batch],
    });
  },

  redo: () => {
    const { grid, undoStack, redoStack } = get();
    const batch = redoStack[redoStack.length - 1];
    if (!batch) return;
    for (const ch of batch) applyChange(grid, ch, ch.after);
    set({
      version: get().version + 1,
      undoStack: [...undoStack, batch],
      redoStack: redoStack.slice(0, -1),
    });
  },

  clear: () => {
    const { grid } = get();
    grid.clear();
    set({ version: get().version + 1, undoStack: [], redoStack: [] });
  },

  exportJSON: () => toJSON(get().grid),

  importJSON: (json) => {
    const grid = fromJSON(json);
    set({ grid, version: get().version + 1, undoStack: [], redoStack: [] });
  },
}));

// ---------- Auto-save (localStorage) ----------
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) useEditor.setState({ grid: fromJSON(saved), version: 1 });
} catch {
  // dữ liệu hỏng -> bỏ qua, bắt đầu level trống
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.version === prev.version) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, toJSON(s.grid, false));
    } catch {
      // localStorage đầy -> đành bỏ qua
    }
  }, 400);
});

// Lưu bảng màu ngay khi đổi.
useEditor.subscribe((s, prev) => {
  if (s.palette === prev.palette) return;
  try {
    localStorage.setItem(PALETTE_KEY, JSON.stringify(s.palette));
  } catch {
    // bỏ qua
  }
});
