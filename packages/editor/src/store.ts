import { create } from 'zustand';
import {
  DEFAULT_LEVEL_META,
  GAME_PALETTE,
  VoxelGrid,
  fromJSON,
  gridBounds,
  gridFromLayers,
  parseUnityAsset,
  toJSON,
  type LevelMeta,
  type Vec3,
  type Voxel,
} from '@voxel/core';

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
const META_KEY = 'voxel-level-meta';

// Bảng màu cố định = 16 ColorType của game + ô tường, không cho sửa/thêm/xóa. Mỗi ô ứng với đúng
// 1 giá trị enum bên Unity, nên đổi hex của một ô là phá luôn ánh xạ đó: block vẽ ra sẽ không còn
// khớp ColorType nào và lúc xuất phải đoán màu gần nhất.
const initialPalette = GAME_PALETTE;

interface EditorState {
  grid: VoxelGrid;
  /** Tăng mỗi khi grid đổi để component render lại (grid là mutable ref). */
  version: number;
  color: string;
  palette: string[];
  mode: ToolMode;
  mirrorX: boolean;
  mirrorY: boolean;
  /** Lọc hiển thị theo màu. Rỗng = hiện tất cả; có phần tử = chỉ hiện các màu này. */
  colorFilter: string[];
  /**
   * Layer đang tắt hiển thị, theo khoá "depthTựĐộng|colorType". Thuần chuyện xem cho dễ — phần
   * xuất .asset không đọc nó, layer tắt vẫn được ghi đủ vào file.
   */
  hiddenLayers: string[];
  toggleLayer: (key: string) => void;
  /** Chỉ hiện đúng layer này, tắt hết phần còn lại (bấm lại lần nữa thì hiện lại tất cả). */
  soloLayer: (key: string, allKeys: string[]) => void;
  showAllLayers: () => void;
  undoStack: Batch[];
  redoStack: Batch[];

  /** Các trường cấp level ngoài phần khối — nhập từ .asset vào đây, xuất ra cũng lấy từ đây. */
  levelMeta: LevelMeta;
  /** depth ép tay, khoá theo "depthTựĐộng|colorType". Xem `gridFromLayers`. */
  depthOverrides: Record<string, number>;
  /** Dời khối về giữa gốc toạ độ lúc xuất. Xem `buildLayers`. */
  recenter: boolean;
  /** Tâm (gốc toạ độ) do người dùng đặt tay; null = tự động theo tâm hộp bao. */
  centerOverride: Vec3 | null;
  /** Hiện marker gốc toạ độ trong scene. */
  showCenter: boolean;
  setLevelMeta: (meta: LevelMeta) => void;
  setDepthOverrides: (overrides: Record<string, number>) => void;
  setRecenter: (recenter: boolean) => void;
  setCenterOverride: (v: Vec3 | null) => void;
  toggleShowCenter: () => void;

  setColor: (color: string) => void;
  toggleColorFilter: (color: string) => void;
  clearColorFilter: () => void;
  setMode: (mode: ToolMode) => void;
  toggleMirror: (axis: 'x' | 'y') => void;

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

  /** Nạp file .asset của Unity, thay toàn bộ level hiện tại. Trả về cảnh báo để hiện cho user. */
  importUnityAsset: (text: string) => string[];
}

function applyChange(grid: VoxelGrid, ch: Change, voxel: Voxel | undefined) {
  if (voxel) grid.set(ch.x, ch.y, ch.z, voxel);
  else grid.delete(ch.x, ch.y, ch.z);
}

// Trục đứng là z, nên hai mặt đối xứng đứng là x=0 và y=0.
/** Nhân bản ô qua mặt đối xứng x=0 / y=0 (ô x -> -1-x) nếu mirror đang bật. */
function expandMirror(cells: Cell[], mx: boolean, my: boolean): Cell[] {
  if (!mx && !my) return cells;
  const out = new Map<string, Cell>();
  const add = (c: Cell) => out.set(`${c[0]},${c[1]},${c[2]}`, c);
  for (const [x, y, z] of cells) {
    add([x, y, z]);
    if (mx) add([-1 - x, y, z]);
    if (my) add([x, -1 - y, z]);
    if (mx && my) add([-1 - x, -1 - y, z]);
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
  mirrorY: false,
  colorFilter: [],
  hiddenLayers: [],
  undoStack: [],
  redoStack: [],

  levelMeta: DEFAULT_LEVEL_META,
  depthOverrides: {},
  recenter: true,
  centerOverride: null,
  showCenter: true,
  setLevelMeta: (levelMeta) => set({ levelMeta }),
  setDepthOverrides: (depthOverrides) => set({ depthOverrides }),
  setRecenter: (recenter) => set({ recenter }),
  setCenterOverride: (centerOverride) => set({ centerOverride }),
  toggleShowCenter: () => set((s) => ({ showCenter: !s.showCenter })),

  setColor: (color) => set({ color }),

  toggleColorFilter: (color) =>
    set((s) => ({
      colorFilter: s.colorFilter.includes(color)
        ? s.colorFilter.filter((c) => c !== color)
        : [...s.colorFilter, color],
    })),
  clearColorFilter: () => set({ colorFilter: [] }),

  toggleLayer: (key) =>
    set((s) => ({
      hiddenLayers: s.hiddenLayers.includes(key)
        ? s.hiddenLayers.filter((k) => k !== key)
        : [...s.hiddenLayers, key],
    })),

  soloLayer: (key, allKeys) =>
    set((s) => {
      const onlyThis = allKeys.filter((k) => k !== key);
      const alreadySolo =
        s.hiddenLayers.length === onlyThis.length && onlyThis.every((k) => s.hiddenLayers.includes(k));
      return { hiddenLayers: alreadySolo ? [] : onlyThis };
    }),

  showAllLayers: () => set({ hiddenLayers: [] }),

  setMode: (mode) => set({ mode }),
  toggleMirror: (axis) =>
    set((s) => (axis === 'x' ? { mirrorX: !s.mirrorX } : { mirrorY: !s.mirrorY })),

  fill: (cells, voxel) => {
    const { grid, undoStack, mirrorX, mirrorY } = get();
    const changes: Batch = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorY)) {
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
    const { grid, undoStack, mirrorX, mirrorY } = get();
    const changes: Batch = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorY)) {
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
    // Scene trống -> tâm về tự động (sẽ nằm trên sàn tại gốc).
    set({ version: get().version + 1, undoStack: [], redoStack: [], centerOverride: null });
  },

  importUnityAsset: (text) => {
    const parsed = parseUnityAsset(text);
    const { grid: raw, depthOverrides, warnings } = gridFromLayers(parsed.layers);

    // File Unity đặt khối quanh gốc (có z âm). Editor thì coi z=0 là mặt sàn và khối phải ĐỨNG
    // trên sàn, nên nâng cả khối lên cho khối thấp nhất chạm sàn (min z = 0). Đặt center = đúng
    // lượng vừa nâng, để lúc xuất trừ center đi là ra lại toạ độ y hệt file gốc.
    const bounds = gridBounds(raw);
    let grid = raw;
    let centerOverride: Vec3 | null = null;
    if (bounds) {
      const dz = -bounds.min.z; // dời z để khối thấp nhất về 0
      if (dz !== 0) {
        grid = new VoxelGrid();
        for (const { x, y, z, voxel } of raw.entries()) grid.set(x, y, z + dz, { ...voxel });
      }
      centerOverride = { x: 0, y: 0, z: dz };
    }

    set({
      grid,
      levelMeta: parsed.meta,
      depthOverrides,
      recenter: true,
      centerOverride,
      version: get().version + 1,
      undoStack: [],
      redoStack: [],
    });
    return [...parsed.warnings, ...warnings];
  },
}));

// ---------- Auto-save (localStorage) ----------
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) useEditor.setState({ grid: fromJSON(saved), version: 1 });
} catch {
  // dữ liệu hỏng -> bỏ qua, bắt đầu level trống
}

// Lưu tách khỏi grid: các trường này đổi theo thao tác riêng (nhập .asset, sửa form xuất) chứ
// không theo `version`, nên gộp chung sẽ bỏ sót thay đổi.
try {
  const saved = localStorage.getItem(META_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    useEditor.setState({
      levelMeta: { ...DEFAULT_LEVEL_META, ...parsed.levelMeta },
      depthOverrides: parsed.depthOverrides ?? {},
      recenter: parsed.recenter ?? true,
      centerOverride: parsed.centerOverride ?? null,
      showCenter: parsed.showCenter ?? true,
    });
  }
} catch {
  // hỏng -> dùng mặc định
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

useEditor.subscribe((s, prev) => {
  if (
    s.levelMeta === prev.levelMeta &&
    s.depthOverrides === prev.depthOverrides &&
    s.recenter === prev.recenter &&
    s.centerOverride === prev.centerOverride &&
    s.showCenter === prev.showCenter
  ) {
    return;
  }
  try {
    localStorage.setItem(
      META_KEY,
      JSON.stringify({
        levelMeta: s.levelMeta,
        depthOverrides: s.depthOverrides,
        recenter: s.recenter,
        centerOverride: s.centerOverride,
        showCenter: s.showCenter,
      }),
    );
  } catch {
    // bỏ qua
  }
});

// Bảng màu cũ (ngẫu nhiên, sửa được) từng được lưu ở đây. Giờ bảng màu là hằng số theo game nên
// key này chỉ còn là rác — dọn để không ai đọc nhầm nó nữa.
try {
  localStorage.removeItem('voxel-palette');
} catch {
  // bỏ qua
}
