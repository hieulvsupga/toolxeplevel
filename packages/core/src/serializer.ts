import { VoxelGrid } from './VoxelGrid';
import { EMPTY_SHOOTERS, makeBlaster, type ShooterSetup } from './blasters';
import { LEVEL_FORMAT_VERSION, type LevelData } from './types';

/** VoxelGrid (+ phần shooter) -> LevelData (JSON-serializable). */
export function serialize(
  grid: VoxelGrid,
  shooters: ShooterSetup = EMPTY_SHOOTERS,
): LevelData {
  const voxels: LevelData['voxels'] = [];
  for (const { x, y, z, voxel } of grid.entries()) {
    const entry: LevelData['voxels'][number] = { p: [x, y, z], c: voxel.color };
    if (voxel.type) entry.t = voxel.type;
    voxels.push(entry);
  }
  const data: LevelData = { version: LEVEL_FORMAT_VERSION, voxels };
  // Chỉ ghi khi thật sự có súng: level chỉ có khối thì JSON giữ đúng hình dạng cũ, đọc/diff dễ hơn.
  if (shooters.blasters.length) data.blasters = shooters.blasters;
  if (shooters.dockColumns.length) data.dockColumns = shooters.dockColumns;
  return data;
}

/** LevelData -> VoxelGrid. */
export function deserialize(data: LevelData): VoxelGrid {
  const grid = new VoxelGrid();
  for (const v of data.voxels) {
    const [x, y, z] = v.p;
    grid.set(x, y, z, { color: v.c, type: v.t });
  }
  return grid;
}

/**
 * Phần shooter trong một `LevelData`.
 *
 * Mỗi súng đi qua `makeBlaster` để field nào thiếu thì lấy mặc định — JSON cũ (hoặc do người khác
 * sửa tay) mà thiếu `iceHp`/`isPilot`… thì đọc lên vẫn là một BlasterEntry đủ field, thay vì
 * `undefined` lọt tới lúc xuất .asset. Bản ghi không có id thì bỏ: không có id thì hàng chờ không
 * cách nào trỏ tới nó.
 */
export function deserializeShooters(data: LevelData): ShooterSetup {
  return {
    blasters: (data.blasters ?? [])
      .filter((b) => b && Number.isFinite(b.id))
      .map((b) => makeBlaster({ ...b })),
    dockColumns: (data.dockColumns ?? []).map((c) => [...c]),
  };
}

export function toJSON(
  grid: VoxelGrid,
  shooters: ShooterSetup = EMPTY_SHOOTERS,
  pretty = true,
): string {
  return JSON.stringify(serialize(grid, shooters), null, pretty ? 2 : 0);
}

export function fromJSON(json: string): { grid: VoxelGrid; shooters: ShooterSetup } {
  const data = JSON.parse(json) as LevelData;
  return { grid: deserialize(data), shooters: deserializeShooters(data) };
}
