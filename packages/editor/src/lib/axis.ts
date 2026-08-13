/**
 * Editor dựng theo Z-up để trùng hệ trục của LevelData. Nhưng model 3D và ảnh nạp vào lại ở hệ
 * Y-up của three.js — hàm này là ranh giới duy nhất giữa hai hệ đó, đặt ngay chỗ voxel hoá xong.
 *
 * Lật dấu một trục là bắt buộc: hoán vị y/z thuần có định thức -1, tức lật gương cả mô hình. Với
 * khối đối xứng thì không ai thấy, nhưng model có chữ hoặc có trái/phải rõ ràng sẽ vào thành ảnh
 * gương.
 */
export function yUpToEditor<T extends { x: number; y: number; z: number }>(item: T): T {
  return { ...item, x: item.x, y: -item.z, z: item.y };
}

export function yUpToEditorAll<T extends { x: number; y: number; z: number }>(items: T[]): T[] {
  return items.map(yUpToEditor);
}
