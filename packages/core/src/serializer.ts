import { VoxelGrid } from './VoxelGrid';
import { LEVEL_FORMAT_VERSION, type LevelData } from './types';

/** VoxelGrid -> LevelData (JSON-serializable). */
export function serialize(grid: VoxelGrid): LevelData {
  const voxels: LevelData['voxels'] = [];
  for (const { x, y, z, voxel } of grid.entries()) {
    const entry: LevelData['voxels'][number] = { p: [x, y, z], c: voxel.color };
    if (voxel.type) entry.t = voxel.type;
    voxels.push(entry);
  }
  return { version: LEVEL_FORMAT_VERSION, voxels };
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

export function toJSON(grid: VoxelGrid, pretty = true): string {
  return JSON.stringify(serialize(grid), null, pretty ? 2 : 0);
}

export function fromJSON(json: string): VoxelGrid {
  return deserialize(JSON.parse(json) as LevelData);
}
