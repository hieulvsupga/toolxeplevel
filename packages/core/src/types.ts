/** Toạ độ lưới nguyên (mỗi ô = 1 khối). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Dữ liệu 1 khối voxel. `type` để mở rộng sau (khối đặc biệt, target, v.v.). */
export interface Voxel {
  color: string;
  type?: string;
}

/** Format file level — nguồn dữ liệu chính để game đọc vào. */
export interface LevelData {
  version: number;
  /** Mỗi voxel: p = [x,y,z], c = màu hex, t = type (tuỳ chọn). */
  voxels: { p: [number, number, number]; c: string; t?: string }[];
}

export const LEVEL_FORMAT_VERSION = 1;
