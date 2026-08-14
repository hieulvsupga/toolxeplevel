import { create } from 'zustand';
import {
  DEFAULT_LEVEL_META,
  GAME_PALETTE,
  VoxelGrid,
  autoShooters,
  blockCountsByColor,
  fromJSON,
  gridBounds,
  gridFromLayers,
  makeBlaster,
  nextBlasterId,
  parseUnityAsset,
  toJSON,
  type BlasterEntry,
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

  /**
   * Phần shooter: pool súng phẳng + các hàng chờ. Giữ đúng dạng của `LevelData` (hàng chứa id, không
   * chứa object) nên mọi hàm dưới đây phải tự lo cho hai thứ khớp nhau — một id trong `dockColumns`
   * mà không có súng tương ứng là level lỗi bên Unity.
   */
  blasters: BlasterEntry[];
  dockColumns: number[][];
  /** Thêm/bớt hàng. Bớt hàng thì súng trong hàng bị bỏ dồn về hàng cuối còn lại. */
  setDockRowCount: (n: number) => void;
  /** Thêm 1 súng vào cuối hàng `row`, id tự cấp. Trả về id vừa tạo. */
  addBlaster: (row: number, color: number, bulletCount: number) => number;
  updateBlaster: (id: number, patch: Partial<BlasterEntry>) => void;
  /** Đổi id (kèm mọi chỗ đang nhắc tới nó). Trả về false nếu id mới không dùng được. */
  changeBlasterId: (id: number, newId: number) => boolean;
  removeBlaster: (id: number) => void;
  /** Dời súng sang hàng khác / đổi vị trí trong hàng. `index` âm hoặc quá dài = về cuối hàng. */
  moveBlaster: (id: number, row: number, index: number) => void;
  /** Sinh sẵn bộ súng khớp số khối từng màu, ghi đè bộ đang có. */
  autoBuildShooters: (rowCount: number, bulletsPerBlaster: number) => void;
  clearShooters: () => void;

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

  blasters: [],
  dockColumns: [],

  setDockRowCount: (n) =>
    set((s) => {
      const want = Math.max(0, Math.min(20, Math.floor(n)));
      if (want === s.dockColumns.length) return {};
      if (want > s.dockColumns.length) {
        const added = Array.from({ length: want - s.dockColumns.length }, () => [] as number[]);
        return { dockColumns: [...s.dockColumns, ...added] };
      }
      // Bớt hàng: dồn súng của các hàng bị cắt về hàng cuối còn lại, chứ không xoá — mất súng lặng
      // lẽ thì tổng đạn không còn khớp số khối mà chẳng ai thấy vì sao.
      const kept = s.dockColumns.slice(0, want).map((c) => [...c]);
      const spill = s.dockColumns.slice(want).flat();
      if (spill.length) {
        if (kept.length) kept[kept.length - 1].push(...spill);
        else kept.push(spill);
      }
      return { dockColumns: kept };
    }),

  addBlaster: (row, color, bulletCount) => {
    const id = nextBlasterId(get().blasters);
    set((s) => {
      const dockColumns = s.dockColumns.length ? s.dockColumns.map((c) => [...c]) : [[]];
      const target = Math.max(0, Math.min(dockColumns.length - 1, row));
      dockColumns[target].push(id);
      return {
        blasters: [...s.blasters, makeBlaster({ id, color, bulletCount })],
        dockColumns,
      };
    });
    return id;
  },

  updateBlaster: (id, patch) =>
    set((s) => ({
      blasters: s.blasters.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)),
    })),

  changeBlasterId: (id, newId) => {
    const { blasters } = get();
    if (!Number.isInteger(newId) || newId <= 0) return false;
    if (newId !== id && blasters.some((b) => b.id === newId)) return false;
    if (!blasters.some((b) => b.id === id)) return false;
    if (newId === id) return true;
    const swap = (ids: number[]) => ids.map((x) => (x === id ? newId : x));
    set((s) => ({
      blasters: s.blasters.map((b) => ({
        ...b,
        id: b.id === id ? newId : b.id,
        connectedBlasterIds: swap(b.connectedBlasterIds),
        chainedBlasterIds: swap(b.chainedBlasterIds),
        innerBlasterIds: swap(b.innerBlasterIds),
      })),
      dockColumns: s.dockColumns.map(swap),
    }));
    return true;
  },

  removeBlaster: (id) =>
    set((s) => ({
      blasters: s.blasters
        .filter((b) => b.id !== id)
        .map((b) => ({
          ...b,
          connectedBlasterIds: b.connectedBlasterIds.filter((x) => x !== id),
          chainedBlasterIds: b.chainedBlasterIds.filter((x) => x !== id),
          innerBlasterIds: b.innerBlasterIds.filter((x) => x !== id),
        })),
      dockColumns: s.dockColumns.map((c) => c.filter((x) => x !== id)),
    })),

  moveBlaster: (id, row, index) =>
    set((s) => {
      if (!s.dockColumns.length) return {};
      const dockColumns = s.dockColumns.map((c) => c.filter((x) => x !== id));
      const target = Math.max(0, Math.min(dockColumns.length - 1, row));
      const column = dockColumns[target];
      const at = index < 0 || index > column.length ? column.length : index;
      column.splice(at, 0, id);
      return { dockColumns };
    }),

  autoBuildShooters: (rowCount, bulletsPerBlaster) => {
    const { grid } = get();
    const setup = autoShooters(blockCountsByColor(grid), { rowCount, bulletsPerBlaster });
    set({ blasters: setup.blasters, dockColumns: setup.dockColumns });
  },

  clearShooters: () => set({ blasters: [], dockColumns: [] }),

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
    // Scene trống -> tâm về tự động (sẽ nằm trên sàn tại gốc). Súng cũng đi theo: số đạn của chúng
    // được chia theo đúng số khối vừa bị xoá nên giữ lại là giữ lại một bộ sai.
    set({
      version: get().version + 1,
      undoStack: [],
      redoStack: [],
      centerOverride: null,
      blasters: [],
      dockColumns: [],
    });
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
      blasters: parsed.shooters.blasters,
      dockColumns: parsed.shooters.dockColumns,
      version: get().version + 1,
      undoStack: [],
      redoStack: [],
    });
    return [...parsed.warnings, ...warnings];
  },
}));

// ---------- Auto-save (localStorage) ----------
// Khối và súng nằm chung một bản ghi `LevelData`: hai thứ này phải khớp nhau (số đạn chia theo đúng
// số khối), nên lưu tách hai chỗ là mở đường cho việc một bên ghi được, một bên không.
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    const { grid, shooters } = fromJSON(saved);
    useEditor.setState({
      grid,
      version: 1,
      blasters: shooters.blasters,
      dockColumns: shooters.dockColumns,
    });
  }
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
    // Bản trước lưu súng ở key này. Chỉ nhận khi bản ghi level ở trên chưa có súng nào, để không
    // xoá mất thứ vừa đọc được.
    if (parsed.blasters) {
      const { blasters: legacy, dockColumns: legacyColumns, ...withoutShooters } = parsed;
      if (!useEditor.getState().blasters.length && legacy.length) {
        useEditor.setState({ blasters: legacy, dockColumns: legacyColumns ?? [] });
      }
      // Và dọn ngay khỏi key cũ: để lại thì lần nào người dùng xoá hết súng, bản cũ này cũng sống
      // lại ở lần mở sau (autosave lúc đó không có súng nên nhánh trên lại chạy).
      try {
        localStorage.setItem(META_KEY, JSON.stringify(withoutShooters));
      } catch {
        // bỏ qua
      }
    }
  }
} catch {
  // hỏng -> dùng mặc định
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  // Sửa súng KHÔNG đụng tới `version` (version chỉ đếm thay đổi trên grid), nên phải so cả hai —
  // chỉ nghe `version` thì thêm/xoá súng sẽ không được lưu.
  if (
    s.version === prev.version &&
    s.blasters === prev.blasters &&
    s.dockColumns === prev.dockColumns
  ) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        toJSON(s.grid, { blasters: s.blasters, dockColumns: s.dockColumns }, false),
      );
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
    // Súng không còn ở đây nữa — chúng nằm cùng khối trong AUTOSAVE_KEY.
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
