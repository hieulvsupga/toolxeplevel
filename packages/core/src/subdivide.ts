import { VoxelGrid } from './VoxelGrid';

/**
 * Chia mỗi khối thành n×n×n khối con. Hình không đổi, chỉ mịn hơn — dùng khi cần một level nhiều
 * khối hơn (nhiều đạn hơn, phá lâu hơn) mà vẫn đúng hình đã dựng.
 *
 * Trần 10: n=10 đã là ×1000 khối, quá đó thì level nào cũng vượt mức tool còn dựng hình nổi.
 */
export const MAX_SUBDIVIDE_FACTOR = 10;

/** Số khối sau khi chia — n³ khối con cho mỗi khối cũ. */
export function subdividedCount(size: number, n: number): number {
  return size * n ** 3;
}

/**
 * Trả về grid MỚI trong đó mỗi khối cũ thành n×n×n khối con cùng màu.
 *
 * Toạ độ nhân đúng n: ô x chiếm khoảng [x, x+1) nên các ô con của nó là x*n … x*n+n-1. Đúng cả với
 * toạ độ âm, nên khối không bị lệch nửa ô về một phía như khi làm tròn quanh tâm.
 *
 * Lưu ý cho chỗ gọi: mọi thứ đo bằng ô lưới đều đổi theo — hộp bao ×n, tâm ×n, số khối ×n³ (nên số
 * đạn của súng cũng phải ×n³ mới còn khớp), và độ sâu (depth) tính lại hoàn toàn vì vỏ ngoài giờ
 * dày n lớp.
 */
export function subdivideGrid(grid: VoxelGrid, n: number): VoxelGrid {
  const factor = Math.floor(n);
  if (!Number.isFinite(factor) || factor < 1) {
    throw new Error(`Tỉ lệ chia phải là số nguyên ≥ 1 (nhận ${n})`);
  }
  if (factor === 1) return grid.clone();

  const out = new VoxelGrid();
  for (const { x, y, z, voxel } of grid.entries()) {
    const bx = x * factor;
    const by = y * factor;
    const bz = z * factor;
    for (let i = 0; i < factor; i++) {
      for (let j = 0; j < factor; j++) {
        for (let k = 0; k < factor; k++) {
          out.set(bx + i, by + j, bz + k, { ...voxel });
        }
      }
    }
  }
  return out;
}
