// `import type` chứ không phải import thường: blasters.ts -> layers.ts -> types.ts, nên import giá
// trị ở đây sẽ tạo vòng lặp module lúc chạy. Kiểu thì bị xoá khi biên dịch nên không có vòng nào.
import type { BlasterEntry } from './blasters';

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
  /**
   * Pool súng phẳng, tham chiếu theo `BlasterEntry.id` — khớp `LevelData.blasters` bên Unity.
   * Vắng mặt = level lưu từ bản tool chưa dựng được phần shooter, không phải "level không có súng".
   */
  blasters?: BlasterEntry[];
  /** Mỗi hàng chờ là một danh sách id súng theo thứ tự — khớp `dockColumns` bên Unity. */
  dockColumns?: number[][];
}

export const LEVEL_FORMAT_VERSION = 1;
