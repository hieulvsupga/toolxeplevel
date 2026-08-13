import { GAME_COLORS, WALL_COLOR_ID } from '@voxel/core';
import { useEditor } from '../store';

/**
 * Bảng tra màu: mỗi ô là một `ColorType` bên Unity.
 *
 * Không sửa/thêm/xóa được — bảng màu này là bản sao của `ColorPaletteData.asset` trong game, nên
 * một ô "màu tự do" sẽ không ứng với ColorType nào và lúc xuất .asset sẽ phải đoán màu gần nhất.
 * Muốn đổi màu thì đổi ở phía Unity rồi cập nhật lại `GAME_COLORS` trong core.
 */
export function PalettePanel() {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);

  return (
    <div className="palette-panel">
      <div className="pal-title">ColorType ({GAME_COLORS.length})</div>
      <div className="pal-list">
        {GAME_COLORS.map((c) => (
          <button
            className={`pal-row${c.hex === color ? ' active' : ''}`}
            key={c.id}
            onClick={() => setColor(c.hex)}
            title={
              c.id === WALL_COLOR_ID
                ? 'ColorType.None — khối tường: không bắn được, không tính vào điều kiện phá xong màn'
                : `ColorType.${c.name} = ${c.id}`
            }
          >
            <span className="pal-swatch" style={{ background: c.hex }} />
            <span className="pal-id">{c.id}</span>
            <span className="pal-name">{c.name}</span>
            <span className="pal-hex">{c.hex}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
