import { useMemo } from 'react';
import {
  VoxelGrid,
  buildLayers,
  gameColorById,
  type BuildLayersResult,
  type GameColor,
  type Vec3,
} from '@voxel/core';
import { useEditor } from '../store';

export interface LayerRow {
  /** Khoá bền theo depth TỰ ĐỘNG — trùng khoá mà panel xuất dùng cho depth ép tay. */
  key: string;
  /** depth sau khi áp ép tay (thứ sẽ nằm trong file). */
  depth: number;
  colorType: number;
  color: GameColor | undefined;
  count: number;
  /**
   * Toạ độ ô trong grid (buildLayers chạy với recenter tắt nên đây đúng là toạ độ editor, dùng
   * thẳng cho recolorCells được). Tham chiếu thẳng vào mảng của buildLayers, không sao chép.
   */
  positions: Vec3[];
}

// buildLayers phải quét toàn grid + BFS tính depth. Cả danh sách layer, phần lọc hiển thị của
// Voxels và của VoxelEdges đều cần nó, nên cache ở mức module thay vì để mỗi component tự memo —
// nếu không thì một lần đặt khối sẽ chạy lại phép tính đó ba lần.
let cache: { grid: VoxelGrid; version: number; result: BuildLayersResult } | null = null;

function layersOf(grid: VoxelGrid, version: number): BuildLayersResult {
  if (cache && cache.grid === grid && cache.version === version) return cache.result;
  // recenter tắt: cần đúng toạ độ ô trong grid để đối chiếu ngược lại từng voxel.
  const result = buildLayers(grid, { recenter: false });
  cache = { grid, version, result };
  return result;
}

/**
 * Danh sách layer của level hiện tại + tập voxel đang bị ẩn.
 *
 * Ẩn/hiện chỉ là chuyện xem cho dễ: `buildLayers` lúc xuất không đọc `hiddenLayers`, nên layer bị
 * tắt vẫn được ghi đầy đủ vào file .asset. Giấu khối khỏi màn hình mà cũng giấu luôn khỏi file thì
 * là mất dữ liệu chứ không phải bộ lọc.
 */
export function useLayers(): { rows: LayerRow[]; hiddenVoxels: Set<string> } {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const depthOverrides = useEditor((s) => s.depthOverrides);
  const hiddenLayers = useEditor((s) => s.hiddenLayers);

  const built = layersOf(grid, version);

  const rows = useMemo(
    () =>
      built.layers
        .map((layer) => {
          const key = `${layer.depth}|${layer.colorType}`;
          return {
            key,
            depth: depthOverrides[key] ?? layer.depth,
            colorType: layer.colorType,
            color: gameColorById(layer.colorType),
            count: layer.voxelPositions.length,
            positions: layer.voxelPositions,
          };
        })
        .sort((a, b) => a.depth - b.depth || a.colorType - b.colorType),
    [built, depthOverrides],
  );

  const hiddenVoxels = useMemo(() => {
    const set = new Set<string>();
    if (!hiddenLayers.length) return set;
    const hide = new Set(hiddenLayers);
    for (const layer of built.layers) {
      if (!hide.has(`${layer.depth}|${layer.colorType}`)) continue;
      for (const p of layer.voxelPositions) set.add(VoxelGrid.key(p.x, p.y, p.z));
    }
    return set;
  }, [built, hiddenLayers]);

  return { rows, hiddenVoxels };
}
