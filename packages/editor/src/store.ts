import { create } from 'zustand';
import {
  DEFAULT_LEVEL_META,
  GAME_PALETTE,
  MAX_DOCK_COUNT,
  VoxelGrid,
  autoBuildSearch,
  blockCountsByColor,
  fromJSON,
  gridBounds,
  gridFromLayers,
  makeBlaster,
  nextBlasterId,
  DEFAULT_WRAPPER_HP,
  nextWrapperId,
  parseUnityAsset,
  subdivideGrid,
  toJSON,
  toggleConnection,
  type AutoBuildOptions,
  type AutoBuildSearchResult,
  type BlasterEntry,
  type BoxWrapper,
  type LevelMeta,
  type WrapperKind,
  type Vec3,
  type Voxel,
} from '@voxel/core';

/** `select2d` = kéo khung trên màn hình rồi chọn các khối rơi vào khung (xem `Marquee2D`). */
export type ToolMode = 'place' | 'remove' | 'paint' | 'select' | 'select2d';

type Cell = [number, number, number];

/** 1 thay đổi trên 1 ô — before/after = undefined nghĩa là ô trống. */
interface Change {
  x: number;
  y: number;
  z: number;
  before?: Voxel;
  after?: Voxel;
}

/**
 * Ảnh chụp các trường NGOÀI grid mà một thao tác có thể đổi kèm. Chỉ "chia nhỏ khối" dùng tới:
 * nó nhân toạ độ lên nên số đạn / tâm / objectScale đều phải co giãn theo, và hoàn tác mà chỉ trả
 * lại khối thì level còn nguyên bộ số của kích cỡ cũ — sai lặng lẽ, chẳng ai thấy.
 */
interface SideState {
  blasters: BlasterEntry[];
  dockColumns: number[][];
  levelMeta: LevelMeta;
  depthOverrides: Record<string, number>;
  centerOverride: Vec3 | null;
  wrappers: BoxWrapper[];
}

/** Một thao tác = 1 nhóm thay đổi (fill cả vùng cũng chỉ 1 lần undo). */
interface Batch {
  cells: Change[];
  /** Không có = thao tác chỉ đụng tới grid. */
  side?: { before: SideState; after: SideState };
}

/**
 * Lọc ô trước khi ghi, áp SAU khi đã nhân bản đối xứng — nên ô sinh ra do mirror cũng bị lọc.
 * Dùng để thao tác không chạm tới khối đang bị ẩn (xem `visibleCellFilter`).
 */
export type CellFilter = (x: number, y: number, z: number) => boolean;

/**
 * Tham số tạo nhanh súng. `startId`/`random` do store tự lo; `grid`/`dockCount` thì store
 * đọc từ chính state của nó, UI không phải truyền lại.
 */
export type AutoBuildInput = Omit<AutoBuildOptions, 'startId' | 'random'>;

/** Những thứ đo bằng ô lưới cần co giãn theo khi chia nhỏ khối. Xem `EditorState.subdivide`. */
export interface SubdivideOptions {
  /**
   * Nhân số đạn của mọi súng lên n³. Mặc định bật: số khối từng màu vừa ×n³, mà tổng đạn phải
   * bằng đúng số khối màu đó thì màn mới phá hết được.
   */
  scaleBullets?: boolean;
  /**
   * Chia `voxelizedObjectScale` cho n. Mặc định bật: khối giờ dài gấp n lần theo mỗi cạnh nên
   * không thu nhỏ lại là nó phình gấp n lần trong game.
   */
  scaleObjectScale?: boolean;
}

/** Một voxel trong cụm đã copy — toạ độ tính từ góc nhỏ nhất của cụm. */
export interface RelVoxel {
  dx: number;
  dy: number;
  dz: number;
  voxel: Voxel;
}

const AUTOSAVE_KEY = 'voxel-level-autosave';
const META_KEY = 'voxel-level-meta';

// Bảng màu cố định = 16 ColorType của game + ô tường, không cho sửa/thêm/xóa. Mỗi ô ứng với đúng
// 1 giá trị enum bên Unity, nên đổi hex của một ô là phá luôn ánh xạ đó: block vẽ ra sẽ không còn
// khớp ColorType nào và lúc xuất phải đoán màu gần nhất.
const initialPalette = GAME_PALETTE;

// Ô đầu bảng màu là ô TƯỜNG (ColorType.None) — lấy nó làm màu mặc định thì mở tool lên đặt khối đầu
// tiên là ra ngay một khối tường: không bắn được, không tính vào điều kiện thắng. Mặc định phải là
// một màu bắn được.
const DEFAULT_COLOR = GAME_PALETTE[1];

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
  /**
   * Hiện danh sách lớp bọc (góc dưới-trái). Nằm trong store chứ không phải state của panel: nút
   * thu gọn ở panel và nút 🧊 trên toolbar phải cùng điều khiển một thứ.
   */
  showWrappers: boolean;
  toggleShowWrappers: () => void;
  /**
   * Lớp bọc đang được soi sáng trong scene (trỏ/bấm vào dòng trong bảng lớp bọc). Chỉ là chuyện
   * xem cho dễ nên KHÔNG lưu vào autosave — mở lại tool thì chẳng có lý do gì còn một cái hộp
   * đang sáng.
   */
  focusedWrapper: number | null;
  setFocusedWrapper: (id: number | null) => void;
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
  /**
   * Sinh sẵn bộ súng khớp số khối từng màu (kèm cơ chế được chọn), ghi đè bộ đang có.
   * Tự chấm điểm để bám mức khó mục tiêu; trả về điểm đạt được, số cơ chế dựng được và
   * ghi chú chỗ dựng thiếu / chỗ thang bị kẹt, để hiện lại cho người dựng level.
   */
  autoBuildShooters: (options: AutoBuildInput) => Omit<AutoBuildSearchResult, 'setup'>;
  clearShooters: () => void;
  /** Nối / bỏ nối hai súng (cơ chế Connected) — luôn ghi cả hai chiều. */
  toggleBlasterConnection: (idA: number, idB: number) => void;

  /**
   * Lớp bọc dạng hộp (`iceWrapperData`). Chỉ giữ HỘP + hp; phần `innerVoxelPositions`/`hpTexts`
   * tính lại từ grid lúc xuất, nên vẽ thêm/xoá khối bên trong là data tự đúng theo.
   */
  wrappers: BoxWrapper[];
  /** Thêm lớp bọc theo một hộp (thường là hộp vùng chọn). Trả về id vừa tạo. */
  addWrapper: (kind: WrapperKind, min: Vec3, max: Vec3, hp?: number) => number;
  updateWrapper: (id: number, patch: Partial<Omit<BoxWrapper, 'id'>>) => void;
  removeWrapper: (id: number) => void;
  clearWrappers: () => void;

  setColor: (color: string) => void;
  toggleColorFilter: (color: string) => void;
  clearColorFilter: () => void;
  setMode: (mode: ToolMode) => void;
  toggleMirror: (axis: 'x' | 'y') => void;

  /**
   * Đặt (voxel) hoặc xóa (null) một loạt ô, gộp thành 1 undo.
   * `keep`: bỏ qua ô không thoả — chỗ gọi dùng để không xoá khối đang bị ẩn.
   */
  fill: (cells: Cell[], voxel: Voxel | null, keep?: CellFilter) => void;
  /** Sơn lại màu các ô ĐÃ CÓ khối trong danh sách (không thêm/xóa). */
  paint: (cells: Cell[], color: string, keep?: CellFilter) => void;
  /** Như paint nhưng KHÔNG áp đối xứng — dùng cho tô màu theo tầng. */
  recolorCells: (cells: Cell[], color: string) => void;
  /** Xóa các ô (không mirror), gộp 1 undo — dùng cho tô màu theo tầng. */
  deleteCells: (cells: Cell[]) => void;
  place: (x: number, y: number, z: number) => void;
  remove: (x: number, y: number, z: number) => void;
  /** Dán một loạt voxel nhiều màu (dùng cho import ảnh) — gộp 1 undo. */
  stampVoxels: (items: { x: number; y: number; z: number; color: string }[]) => void;
  /**
   * Dời các ô đi một khoảng (cắt chỗ cũ, ghi chỗ mới), gộp 1 undo. Vùng nguồn và
   * vùng đích chồng nhau vẫn đúng vì tính trạng thái cuối của từng ô trước khi ghi.
   */
  moveCells: (cells: Cell[], dx: number, dy: number, dz: number) => void;
  /** Dán một cụm voxel (toạ độ tương đối) vào gốc `at`, gộp 1 undo. */
  pasteVoxels: (items: RelVoxel[], at: Cell) => void;
  /**
   * Ghi thẳng trạng thái cuối của một loạt ô, gộp 1 undo: `color` = màu mới, `null` = xoá.
   *
   * Có sẵn `fill`/`paint`/`deleteCells` rồi, nhưng mỗi cái là một batch undo riêng — mà dán cả một
   * tầng thì vừa phải sơn ô có khối, vừa thêm ô trống, vừa xoá ô dư, cả ba trong ĐÚNG MỘT lần undo.
   * Không áp đối xứng và không tự lọc theo hiển thị: chỗ gọi tự lo.
   */
  applyCells: (items: { x: number; y: number; z: number; color: string | null }[]) => void;
  /**
   * Chia mỗi khối thành n×n×n khối con — hình y nguyên, số khối ×n³. Gộp 1 undo (kể cả phần
   * chỉnh kèm ở `SubdivideOptions`). Trả về số khối sau khi chia, 0 = không làm gì.
   */
  subdivide: (n: number, options?: SubdivideOptions) => number;
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

/**
 * Ghi trạng thái CUỐI của từng ô vào grid rồi trả về batch undo. Nhận sẵn danh sách
 * "ô -> voxel mới" (undefined = xoá) nên chỗ gọi được phép tính đè lẫn nhau trước khi
 * ghi — cần cho việc dời cụm khối mà vùng nguồn/đích chồng lên nhau.
 */
function applyTargets(
  grid: VoxelGrid,
  targets: { x: number; y: number; z: number; after?: Voxel }[],
): Change[] {
  const changes: Change[] = [];
  for (const t of targets) {
    const before = grid.get(t.x, t.y, t.z);
    if (!before && !t.after) continue;
    if (before && t.after && before.color === t.after.color && before.type === t.after.type) {
      continue;
    }
    applyChange(grid, t, t.after);
    changes.push({ x: t.x, y: t.y, z: t.z, before, after: t.after });
  }
  return changes;
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
  color: DEFAULT_COLOR,
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
  showWrappers: true,
  toggleShowWrappers: () => set((s) => ({ showWrappers: !s.showWrappers })),
  focusedWrapper: null,
  setFocusedWrapper: (focusedWrapper) =>
    set((s) => (s.focusedWrapper === focusedWrapper ? s : { focusedWrapper })),
  setLevelMeta: (levelMeta) => set({ levelMeta }),
  setDepthOverrides: (depthOverrides) => set({ depthOverrides }),
  setRecenter: (recenter) => set({ recenter }),
  setCenterOverride: (centerOverride) => set({ centerOverride }),
  toggleShowCenter: () => set((s) => ({ showCenter: !s.showCenter })),

  blasters: [],
  dockColumns: [],
  wrappers: [],

  addWrapper: (kind, min, max, hp = DEFAULT_WRAPPER_HP) => {
    const id = nextWrapperId(get().wrappers);
    set((s) => ({
      wrappers: [
        ...s.wrappers,
        {
          id,
          kind,
          // Chuẩn hoá hai đầu: chỗ gọi truyền hộp vùng chọn, mà hộp đó có thể ngược đầu.
          min: {
            x: Math.min(min.x, max.x),
            y: Math.min(min.y, max.y),
            z: Math.min(min.z, max.z),
          },
          max: {
            x: Math.max(min.x, max.x),
            y: Math.max(min.y, max.y),
            z: Math.max(min.z, max.z),
          },
          hp: Math.max(1, Math.floor(hp)),
        },
      ],
    }));
    return id;
  },

  updateWrapper: (id, patch) =>
    set((s) => ({
      wrappers: s.wrappers.map((w) => (w.id === id ? { ...w, ...patch, id: w.id } : w)),
    })),

  removeWrapper: (id) =>
    set((s) => ({
      wrappers: s.wrappers.filter((w) => w.id !== id),
      focusedWrapper: s.focusedWrapper === id ? null : s.focusedWrapper,
    })),

  clearWrappers: () => set({ wrappers: [], focusedWrapper: null }),

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

  autoBuildShooters: (options) => {
    const { grid, levelMeta } = get();
    const { setup, ...rest } = autoBuildSearch(blockCountsByColor(grid), {
      ...options,
      grid,
      dockCount: levelMeta.dockCount,
    });
    set({ blasters: setup.blasters, dockColumns: setup.dockColumns });
    return rest;
  },

  clearShooters: () => set({ blasters: [], dockColumns: [] }),

  toggleBlasterConnection: (idA, idB) =>
    set((s) => ({ blasters: toggleConnection(s.blasters, idA, idB) })),

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

  fill: (cells, voxel, keep) => {
    const { grid, undoStack, mirrorX, mirrorY } = get();
    const changes: Change[] = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorY)) {
      if (keep && !keep(x, y, z)) continue;
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
      undoStack: [...undoStack, { cells: changes }],
      redoStack: [],
    });
  },

  paint: (cells, color, keep) => {
    const { grid, undoStack, mirrorX, mirrorY } = get();
    const changes: Change[] = [];
    for (const [x, y, z] of expandMirror(cells, mirrorX, mirrorY)) {
      if (keep && !keep(x, y, z)) continue;
      const before = grid.get(x, y, z);
      if (!before || before.color === color) continue;
      const after: Voxel = { ...before, color };
      grid.set(x, y, z, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({
      version: get().version + 1,
      undoStack: [...undoStack, { cells: changes }],
      redoStack: [],
    });
  },

  recolorCells: (cells, color) => {
    const { grid, undoStack } = get();
    const changes: Change[] = [];
    for (const [x, y, z] of cells) {
      const before = grid.get(x, y, z);
      if (!before || before.color === color) continue;
      const after: Voxel = { ...before, color };
      grid.set(x, y, z, after);
      changes.push({ x, y, z, before, after });
    }
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, { cells: changes }], redoStack: [] });
  },

  deleteCells: (cells) => {
    const { grid, undoStack } = get();
    const changes: Change[] = [];
    for (const [x, y, z] of cells) {
      const before = grid.get(x, y, z);
      if (!before) continue;
      grid.delete(x, y, z);
      changes.push({ x, y, z, before, after: undefined });
    }
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, { cells: changes }], redoStack: [] });
  },

  place: (x, y, z) => get().fill([[x, y, z]], { color: get().color }),
  remove: (x, y, z) => get().fill([[x, y, z]], null),

  stampVoxels: (items) => {
    const { grid, undoStack } = get();
    const changes: Change[] = [];
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
      undoStack: [...undoStack, { cells: changes }],
      redoStack: [],
    });
  },

  moveCells: (cells, dx, dy, dz) => {
    if (!dx && !dy && !dz) return;
    const { grid, undoStack } = get();
    const targets = new Map<string, { x: number; y: number; z: number; after?: Voxel }>();
    // Ô nguồn thành trống trước...
    for (const [x, y, z] of cells) {
      if (!grid.has(x, y, z)) continue;
      targets.set(VoxelGrid.key(x, y, z), { x, y, z, after: undefined });
    }
    // ...rồi ô đích ghi đè lên, nên phần chồng nhau giữ được khối thay vì bị xoá.
    for (const [x, y, z] of cells) {
      const v = grid.get(x, y, z);
      if (!v) continue;
      const tx = x + dx;
      const ty = y + dy;
      const tz = z + dz;
      targets.set(VoxelGrid.key(tx, ty, tz), { x: tx, y: ty, z: tz, after: { ...v } });
    }
    const changes = applyTargets(grid, [...targets.values()]);
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, { cells: changes }], redoStack: [] });
  },

  pasteVoxels: (items, [ax, ay, az]) => {
    const { grid, undoStack } = get();
    const changes = applyTargets(
      grid,
      items.map(({ dx, dy, dz, voxel }) => ({
        x: ax + dx,
        y: ay + dy,
        z: az + dz,
        after: { ...voxel },
      })),
    );
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, { cells: changes }], redoStack: [] });
  },

  applyCells: (items) => {
    const { grid, undoStack } = get();
    const changes = applyTargets(
      grid,
      items.map(({ x, y, z, color }) => ({ x, y, z, after: color ? { color } : undefined })),
    );
    if (!changes.length) return;
    set({ version: get().version + 1, undoStack: [...undoStack, { cells: changes }], redoStack: [] });
  },

  subdivide: (n, options) => {
    const factor = Math.floor(n);
    const state = get();
    const { grid } = state;
    if (!Number.isFinite(factor) || factor < 2 || !grid.size) return 0;

    const cube = factor ** 3;
    const next = subdivideGrid(grid, factor);
    // Ô cũ về trống trước, ô mới ghi đè lên sau — như `moveCells`: khối nằm ngay gốc toạ độ có ô
    // cũ trùng ô con mới, tính theo thứ tự này thì nó được giữ chứ không bị chính mình xoá.
    const targets = new Map<string, { x: number; y: number; z: number; after?: Voxel }>();
    for (const { x, y, z } of grid.entries()) {
      targets.set(VoxelGrid.key(x, y, z), { x, y, z, after: undefined });
    }
    for (const { x, y, z, voxel } of next.entries()) {
      targets.set(VoxelGrid.key(x, y, z), { x, y, z, after: voxel });
    }
    const cells = applyTargets(grid, [...targets.values()]);
    if (!cells.length) return grid.size;

    const before: SideState = {
      blasters: state.blasters,
      dockColumns: state.dockColumns,
      levelMeta: state.levelMeta,
      depthOverrides: state.depthOverrides,
      centerOverride: state.centerOverride,
      wrappers: state.wrappers,
    };
    const center = state.centerOverride;
    const after: SideState = {
      blasters:
        (options?.scaleBullets ?? true)
          ? state.blasters.map((b) => ({ ...b, bulletCount: b.bulletCount * cube }))
          : state.blasters,
      dockColumns: state.dockColumns,
      levelMeta:
        (options?.scaleObjectScale ?? true)
          ? {
              ...state.levelMeta,
              voxelizedObjectScale: state.levelMeta.voxelizedObjectScale / factor,
            }
          : state.levelMeta,
      // depth tính lại từ đầu sau khi chia (vỏ ngoài giờ dày n lớp), nên khoá "depth|màu" cũ trỏ
      // sang layer khác hẳn — giữ lại là ép nhầm depth cho một layer không liên quan.
      depthOverrides: {},
      // Tâm cũng đo bằng ô lưới: giữ nguyên là khối lệch đi so với chỗ nó vốn đứng lúc xuất.
      centerOverride: center
        ? { x: center.x * factor, y: center.y * factor, z: center.z * factor }
        : null,
      // Hộp bọc cũng đo bằng ô lưới: ô [m..M] nay thành [m*n .. M*n+n-1], tức vẫn bọc đúng chỗ cũ.
      wrappers: state.wrappers.map((w) => ({
        ...w,
        min: { x: w.min.x * factor, y: w.min.y * factor, z: w.min.z * factor },
        max: {
          x: w.max.x * factor + factor - 1,
          y: w.max.y * factor + factor - 1,
          z: w.max.z * factor + factor - 1,
        },
      })),
    };

    set({
      version: state.version + 1,
      undoStack: [...state.undoStack, { cells, side: { before, after } }],
      redoStack: [],
      ...after,
    });
    return grid.size;
  },

  undo: () => {
    const { grid, undoStack, redoStack } = get();
    const batch = undoStack[undoStack.length - 1];
    if (!batch) return;
    for (const ch of batch.cells) applyChange(grid, ch, ch.before);
    set({
      version: get().version + 1,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, batch],
      ...(batch.side ? batch.side.before : null),
    });
  },

  redo: () => {
    const { grid, undoStack, redoStack } = get();
    const batch = redoStack[redoStack.length - 1];
    if (!batch) return;
    for (const ch of batch.cells) applyChange(grid, ch, ch.after);
    set({
      version: get().version + 1,
      undoStack: [...undoStack, batch],
      redoStack: redoStack.slice(0, -1),
      ...(batch.side ? batch.side.after : null),
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
      wrappers: [],
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

    // Khoang chờ của game chỉ có 5 ô. File ghi nhiều hơn thì kẹp lại, không thì mọi phép kiểm
    // (thử giải, chấm độ khó) chạy trên một khoang rộng hơn thực tế và báo màn dễ hơn màn thật.
    const dockWarnings: string[] = [];
    let meta = parsed.meta;
    if (meta.dockCount > MAX_DOCK_COUNT) {
      dockWarnings.push(
        `dockCount trong file là ${meta.dockCount}, mà khoang chờ của game chỉ có ${MAX_DOCK_COUNT} ô — ` +
          `đã kẹp về ${MAX_DOCK_COUNT}.`,
      );
      meta = { ...meta, dockCount: MAX_DOCK_COUNT };
    }

    set({
      grid,
      levelMeta: meta,
      depthOverrides,
      recenter: true,
      centerOverride,
      blasters: parsed.shooters.blasters,
      dockColumns: parsed.shooters.dockColumns,
      // Hộp bọc đọc từ file đã ở toạ độ editor, nhưng khối thì vừa bị nâng lên cho chạm sàn (dz) —
      // phải nâng hộp theo, không thì lớp bọc lệch khỏi cụm nó bọc.
      wrappers: parsed.wrappers.map((w) => ({
        ...w,
        min: { ...w.min, z: w.min.z + (centerOverride?.z ?? 0) },
        max: { ...w.max, z: w.max.z + (centerOverride?.z ?? 0) },
      })),
      version: get().version + 1,
      undoStack: [],
      redoStack: [],
    });
    return [...parsed.warnings, ...warnings, ...dockWarnings];
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
      showWrappers: parsed.showWrappers ?? true,
      wrappers: parsed.wrappers ?? [],
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
    s.showCenter === prev.showCenter &&
    s.showWrappers === prev.showWrappers &&
    s.wrappers === prev.wrappers
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
        showWrappers: s.showWrappers,
        // Lớp bọc lưu cùng META (không phải cùng grid): nó là dữ liệu cấp level như levelMeta, và
        // đổi theo thao tác riêng chứ không theo `version` của grid.
        wrappers: s.wrappers,
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
