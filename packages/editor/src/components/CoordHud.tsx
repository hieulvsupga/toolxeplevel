import { useMemo } from 'react';
import { VoxelGrid, computeDepths, gameColorByHex, recenterOffset } from '@voxel/core';
import { useEditor } from '../store';
import { useHoverBlock } from './hoverStore';

/**
 * Góc phải trên: toạ độ của khối chuột đang trỏ.
 *
 * Editor và LevelData dùng chung hệ trục nên chỉ có MỘT bộ toạ độ. Khi bật dời tâm thì file xuất
 * ra bị lệch đi một offset cố định — lúc đó hiện thêm dòng toạ độ sau khi dời, vì đó mới là con số
 * nằm trong file .asset.
 */
export function CoordHud() {
  const block = useHoverBlock((s) => s.block);
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const recenter = useEditor((s) => s.recenter);
  const centerOverride = useEditor((s) => s.centerOverride);

  const hovering = block !== null;

  // Cả hai đại lượng dưới đây phải quét toàn grid. Chỉ tính khi chuột thật sự đang ở trên khối —
  // `hovering` chỉ đổi lúc vào/ra khỏi mô hình, nên rê chuột trên bề mặt không tính lại lần nào.
  const offset = useMemo(
    () => (hovering ? recenterOffset(grid, recenter, centerOverride) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version, recenter, centerOverride, hovering],
  );
  const depths = useMemo(
    () => (hovering ? computeDepths(grid) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version, hovering],
  );

  if (!block || !offset) return null;

  const [x, y, z] = block.cell;
  const shifted = offset.x || offset.y || offset.z;
  const depth = depths?.get(VoxelGrid.key(x, y, z)) ?? 0;
  const color = gameColorByHex(block.color);

  return (
    <div className="hud">
      <div>
        <span className="hud-k">toạ độ</span> {x}, {y}, {z}
      </div>
      {shifted && (
        <div title="Toạ độ trong file .asset — đang bật dời khối về giữa gốc toạ độ">
          <span className="hud-k">.asset</span> {x - offset.x}, {y - offset.y}, {z - offset.z}
        </div>
      )}
      <div>
        <span className="hud-k">depth</span> {depth}
      </div>
      <div>
        <span className="hud-k">màu</span>
        <span className="hud-swatch" style={{ background: block.color }} />
        {color ? `${color.name} (${color.id})` : block.color}
      </div>
    </div>
  );
}
