import { useMemo } from 'react';
import {
  VoxelGrid,
  buildLayers,
  gameColorById,
  wrapperCellSet,
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
  const wrappers = useEditor((s) => s.wrappers);
  const isolate = useEditor((s) => s.isolateWrapper);

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
    const hidden = hiddenSetOf(built, hiddenLayers);
    // Soi riêng một lớp bọc: mọi khối KHÔNG thuộc nó bị ẩn. Nhét vào chung `hiddenVoxels` thay vì
    // làm một đường lọc riêng, để mọi chỗ đang đọc tập này (khối, viền khối, bảng tô tầng) cùng ẩn
    // một kiểu — thêm đường lọc riêng là kiểu gì cũng sót một chỗ.
    const w = isolate === null ? null : wrappers.find((x) => x.id === isolate);
    if (w) {
      const keep = wrapperCellSet(w);
      for (const { x, y, z } of grid.entries()) {
        if (!keep.has(`${x},${y},${z}`)) hidden.add(VoxelGrid.key(x, y, z));
      }
    }
    return hidden;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, hiddenLayers, isolate, wrappers, grid, version]);

  return { rows, hiddenVoxels };
}

function hiddenSetOf(built: BuildLayersResult, hiddenLayers: string[]): Set<string> {
  const set = new Set<string>();
  if (!hiddenLayers.length) return set;
  const hide = new Set(hiddenLayers);
  for (const layer of built.layers) {
    if (!hide.has(`${layer.depth}|${layer.colorType}`)) continue;
    for (const p of layer.voxelPositions) set.add(VoxelGrid.key(p.x, p.y, p.z));
  }
  return set;
}

/**
 * Bộ lọc "ô này đang THẤY được không" — bản không-hook, để phần xử lý chuột và các thao tác vùng
 * dùng được.
 *
 * Sơn / xoá / dời chỉ nên chạm tới khối đang hiện: khối bị tắt layer hoặc bị bộ lọc màu ẩn đi thì
 * người dựng không thấy nó, mà một cú kéo vẫn sửa nó thì hỏng data mà không ai biết. Ô TRỐNG luôn
 * tính là thấy được, nên phần ĐẶT khối không bị bộ lọc này chắn.
 */
export function visibleCellFilter(): (x: number, y: number, z: number) => boolean {
  const { grid, version, hiddenLayers, colorFilter } = useEditor.getState();
  const hidden = hiddenLayers.length ? hiddenSetOf(layersOf(grid, version), hiddenLayers) : null;
  const keep = colorFilter.length ? new Set(colorFilter) : null;
  if (!hidden && !keep) return () => true;
  return (x, y, z) => {
    if (hidden && hidden.has(VoxelGrid.key(x, y, z))) return false;
    if (keep) {
      const voxel = grid.get(x, y, z);
      if (voxel && !keep.has(voxel.color)) return false;
    }
    return true;
  };
}
