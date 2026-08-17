import { WALL_HEX } from '@voxel/core';
import { useEditor } from '../store';

/**
 * Dãy ô bảng màu dùng chung cho mọi màn (toolbar, tô tầng, nhập ảnh, nhập model).
 *
 * Gom về một chỗ vì ô TƯỜNG phải trông khác hẳn các ô còn lại: nó không phải một màu để tô cho đẹp
 * mà là một cơ chế (khối không bắn được). Để nó là ô xám trơn thì nhìn y như một màu thường, mà bốn
 * bảng màu chép tay bốn nơi thì kiểu gì cũng có chỗ quên.
 */
export function PaletteSwatches() {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const palette = useEditor((s) => s.palette);

  return (
    <>
      {palette.map((c, i) => {
        const wall = c === WALL_HEX;
        return (
          <button
            key={i}
            className={`swatch${c === color ? ' active' : ''}${wall ? ' swatch-wall' : ''}`}
            style={{ backgroundColor: c }}
            title={wall ? '🧱 Tường — khối không bắn được, dùng để bịt hướng bắn' : c}
            onClick={() => setColor(c)}
          >
            {wall ? '🧱' : null}
          </button>
        );
      })}
    </>
  );
}
