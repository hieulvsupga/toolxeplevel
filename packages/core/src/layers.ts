import { VoxelGrid } from './VoxelGrid';
import { gameColorById, matchGameColor, type GameColor } from './gameColors';
import type { Vec3 } from './types';

/**
 * Một `LayerData` bên Unity: nhóm voxel *cùng màu, cùng độ sâu* — đơn vị mà gameplay coi là một
 * mảng bắn được.
 */
export interface LevelLayer {
  depth: number;
  /** Giá trị enum `ColorType`. 0 = None = tường. */
  colorType: number;
  voxelPositions: Vec3[];
}

export interface BuildLayersOptions {
  /**
   * Dời khối về giữa gốc toạ độ sau khi đổi trục. Mọi level mẫu đều nằm quanh gốc (khối 11³ chạy
   * -5..5), và các trường `voxelizedObject*Position` bên Unity đều tính theo tâm đó.
   */
  recenter?: boolean;
  /**
   * Tâm do người dùng đặt tay (thay cho tâm hộp bao tự động). null/không có = tự động.
   * Chỉ có tác dụng khi `recenter` bật.
   */
  centerOverride?: Vec3 | null;
}

export interface ApproximatedColor {
  hex: string;
  mappedTo: GameColor;
  count: number;
}

export interface BuildLayersResult {
  layers: LevelLayer[];
  voxelCount: number;
  maxDepth: number;
  /** Hộp bao trong không gian data (sau khi đổi trục / dời tâm). */
  bounds: { min: Vec3; max: Vec3 } | null;
  /** Màu không có trong bảng màu game nên đã phải dò màu gần nhất — cần cảnh báo người dùng. */
  approximatedColors: ApproximatedColor[];
}

const NEIGHBORS_6: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * `depth` của từng voxel = số lớp phải bóc từ ngoài vào mới tới nó.
 *
 * depth 0 là vỏ ngoài — voxel có ít nhất một mặt hở; depth 1 là lớp lộ ra sau khi bóc hết depth 0,
 * và cứ thế. Cách tính này (BFS lan từ vỏ vào, láng giềng 6 mặt) tái tạo đúng `depth` trong data
 * gốc: kiểm trên các file khối 11³ khớp 1331/1331 voxel.
 *
 * Lưu ý phải dùng láng giềng 6 mặt chứ không phải 26: với láng giềng 26 thì kết quả lệch hẳn so
 * với data gốc, vì voxel chạm nhau ở cạnh/góc không được coi là che nhau.
 */
export function computeDepths(grid: VoxelGrid): Map<string, number> {
  const occupied = new Set<string>();
  for (const { x, y, z } of grid.entries()) occupied.add(VoxelGrid.key(x, y, z));

  const depths = new Map<string, number>();
  const queue: string[] = [];

  for (const key of occupied) {
    const [x, y, z] = VoxelGrid.parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS_6) {
      if (!occupied.has(VoxelGrid.key(x + dx, y + dy, z + dz))) {
        depths.set(key, 0);
        queue.push(key);
        break;
      }
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    const [x, y, z] = VoxelGrid.parseKey(key);
    const next = depths.get(key)! + 1;
    for (const [dx, dy, dz] of NEIGHBORS_6) {
      const nk = VoxelGrid.key(x + dx, y + dy, z + dz);
      if (!occupied.has(nk) || depths.has(nk)) continue;
      depths.set(nk, next);
      queue.push(nk);
    }
  }

  return depths;
}

/**
 * Hộp bao của toàn bộ grid, TRƯỚC khi dời tâm.
 *
 * Editor và data dùng chung một hệ trục (z là trục đứng), nên ở đây không có phép đổi trục nào —
 * toạ độ một khối trong editor chính là toạ độ của nó trong file .asset, chỉ trừ phép dời tâm.
 */
export function gridBounds(grid: VoxelGrid): { min: Vec3; max: Vec3 } | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  for (const { x, y, z } of grid.entries()) {
    if (!min || !max) {
      min = { x, y, z };
      max = { x, y, z };
      continue;
    }
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  return min && max ? { min, max } : null;
}

/**
 * Lượng phải trừ khỏi toạ độ để khối nằm giữa gốc — nguồn duy nhất cho phép dời tâm, để HUD toạ
 * độ và file xuất ra không bao giờ nói hai con số khác nhau về cùng một khối.
 */
export function recenterOffset(
  grid: VoxelGrid,
  recenter: boolean,
  override?: Vec3 | null,
): Vec3 {
  if (!recenter) return { x: 0, y: 0, z: 0 };
  // Tâm đặt tay: làm tròn để toạ độ trong file .asset vẫn nguyên.
  if (override) {
    return { x: Math.round(override.x), y: Math.round(override.y), z: Math.round(override.z) };
  }
  const bounds = gridBounds(grid);
  if (!bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: Math.round((bounds.min.x + bounds.max.x) / 2),
    y: Math.round((bounds.min.y + bounds.max.y) / 2),
    z: Math.round((bounds.min.z + bounds.max.z) / 2),
  };
}

/**
 * VoxelGrid -> danh sách `LayerData`.
 *
 * Gom theo cặp (depth, colorType), sắp depth tăng dần rồi colorType tăng dần, và sắp voxel trong
 * mỗi layer theo x, y, z tăng dần — đúng thứ tự các file mẫu đang có, để diff giữa data mình xuất
 * và data gốc đọc được bằng mắt.
 */
export function buildLayers(
  grid: VoxelGrid,
  options: BuildLayersOptions = {},
): BuildLayersResult {
  const { recenter = true, centerOverride = null } = options;
  const depths = computeDepths(grid);

  const approximated = new Map<string, ApproximatedColor>();
  const entries: { pos: Vec3; depth: number; colorType: number }[] = [];

  for (const { x, y, z, voxel } of grid.entries()) {
    const match = matchGameColor(voxel.color);
    if (!match.exact) {
      const seen = approximated.get(voxel.color);
      if (seen) seen.count++;
      else approximated.set(voxel.color, { hex: voxel.color, mappedTo: match.color, count: 1 });
    }
    entries.push({
      pos: { x, y, z },
      depth: depths.get(VoxelGrid.key(x, y, z)) ?? 0,
      colorType: match.color.id,
    });
  }

  const rawBounds = gridBounds(grid);
  if (!entries.length || !rawBounds) {
    return {
      layers: [],
      voxelCount: 0,
      maxDepth: 0,
      bounds: null,
      approximatedColors: [],
    };
  }

  const offset = recenterOffset(grid, recenter, centerOverride);
  for (const entry of entries) {
    entry.pos = {
      x: entry.pos.x - offset.x,
      y: entry.pos.y - offset.y,
      z: entry.pos.z - offset.z,
    };
  }
  const min: Vec3 = {
    x: rawBounds.min.x - offset.x,
    y: rawBounds.min.y - offset.y,
    z: rawBounds.min.z - offset.z,
  };
  const max: Vec3 = {
    x: rawBounds.max.x - offset.x,
    y: rawBounds.max.y - offset.y,
    z: rawBounds.max.z - offset.z,
  };

  const groups = new Map<string, LevelLayer>();
  for (const { pos, depth, colorType } of entries) {
    const key = `${depth}|${colorType}`;
    let layer = groups.get(key);
    if (!layer) {
      layer = { depth, colorType, voxelPositions: [] };
      groups.set(key, layer);
    }
    layer.voxelPositions.push(pos);
  }

  const layers = [...groups.values()].sort(
    (a, b) => a.depth - b.depth || a.colorType - b.colorType,
  );
  for (const layer of layers) {
    layer.voxelPositions.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  }

  return {
    layers,
    voxelCount: entries.length,
    maxDepth: layers.length ? layers[layers.length - 1].depth : 0,
    bounds: { min, max },
    approximatedColors: [...approximated.values()].sort((a, b) => b.count - a.count),
  };
}

export interface GridFromLayersResult {
  grid: VoxelGrid;
  /**
   * Các layer có `depth` không khớp với depth tính tự động, khoá theo "depthTựĐộng|colorType" —
   * đúng dạng khoá mà panel xuất dùng. Giữ lại để nhập rồi xuất ra không âm thầm làm mất depth
   * designer đã ép tay (layer depth 12 trong Banana.asset là ví dụ có thật).
   */
  depthOverrides: Record<string, number>;
  warnings: string[];
}

/** Ngược của {@link buildLayers}: `LayerData` đọc từ .asset -> VoxelGrid. */
export function gridFromLayers(layers: LevelLayer[]): GridFromLayersResult {
  const grid = new VoxelGrid();
  const warnings: string[] = [];
  const unknownColorTypes = new Set<number>();
  let overlapping = 0;

  for (const layer of layers) {
    const color = gameColorById(layer.colorType);
    if (!color) {
      unknownColorTypes.add(layer.colorType);
      continue;
    }
    for (const p of layer.voxelPositions) {
      if (grid.has(p.x, p.y, p.z)) overlapping++;
      grid.set(p.x, p.y, p.z, { color: color.hex });
    }
  }

  if (unknownColorTypes.size) {
    warnings.push(
      `Bỏ qua colorType không có trong bảng màu game: ${[...unknownColorTypes].join(', ')}.`,
    );
  }
  if (overlapping) {
    warnings.push(`${overlapping} voxel bị nhiều layer ghi đè lên nhau — giữ layer sau cùng.`);
  }

  // depth trong file có thể là depth ép tay. So với depth tự động của chính khối vừa dựng lại để
  // biết layer nào bị ép; chỉ ghi nhận khi cả nhóm (depthTựĐộng, colorType) thống nhất một giá
  // trị, vì một khoá không thể biểu diễn nổi trường hợp mâu thuẫn.
  const autoDepths = computeDepths(grid);
  const seen = new Map<string, Set<number>>();
  for (const layer of layers) {
    if (!gameColorById(layer.colorType)) continue;
    for (const p of layer.voxelPositions) {
      const auto = autoDepths.get(VoxelGrid.key(p.x, p.y, p.z)) ?? 0;
      const key = `${auto}|${layer.colorType}`;
      const set = seen.get(key) ?? new Set<number>();
      set.add(layer.depth);
      seen.set(key, set);
    }
  }

  const depthOverrides: Record<string, number> = {};
  let ambiguous = 0;
  for (const [key, depths] of seen) {
    if (depths.size > 1) {
      ambiguous++;
      continue;
    }
    const [fileDepth] = depths;
    const autoDepth = Number(key.split('|')[0]);
    if (fileDepth !== autoDepth) depthOverrides[key] = fileDepth;
  }
  if (ambiguous) {
    warnings.push(
      `${ambiguous} nhóm voxel có depth mâu thuẫn giữa các layer — dùng depth tính tự động.`,
    );
  }

  return { grid, depthOverrides, warnings };
}
