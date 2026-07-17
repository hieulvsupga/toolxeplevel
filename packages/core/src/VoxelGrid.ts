import type { Voxel } from './types';

/**
 * Lưu trữ voxel dạng sparse: chỉ giữ những ô có khối.
 * Key = "x,y,z". Đây là cấu trúc dữ liệu trung tâm mà mọi generator
 * (ảnh 2D, model 3D, AI) đều output ra, và editor thao tác trên.
 */
export class VoxelGrid {
  private map = new Map<string, Voxel>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  static parseKey(key: string): [number, number, number] {
    const [x, y, z] = key.split(',').map(Number);
    return [x, y, z];
  }

  set(x: number, y: number, z: number, voxel: Voxel): void {
    this.map.set(VoxelGrid.key(x, y, z), voxel);
  }

  get(x: number, y: number, z: number): Voxel | undefined {
    return this.map.get(VoxelGrid.key(x, y, z));
  }

  has(x: number, y: number, z: number): boolean {
    return this.map.has(VoxelGrid.key(x, y, z));
  }

  delete(x: number, y: number, z: number): boolean {
    return this.map.delete(VoxelGrid.key(x, y, z));
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Duyệt toàn bộ voxel kèm toạ độ. */
  *entries(): IterableIterator<{ x: number; y: number; z: number; voxel: Voxel }> {
    for (const [key, voxel] of this.map) {
      const [x, y, z] = VoxelGrid.parseKey(key);
      yield { x, y, z, voxel };
    }
  }

  clone(): VoxelGrid {
    const g = new VoxelGrid();
    for (const [key, voxel] of this.map) {
      g.map.set(key, { ...voxel });
    }
    return g;
  }
}
