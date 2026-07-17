import { useEditor } from '../store';
import { useInput } from './input';
import type { Cell } from './Voxels';

/** Bảng thông tin góc màn hình: toạ độ ô đang trỏ, số khối, chế độ. */
export function Hud({ hover }: { hover: Cell | null }) {
  const count = useEditor((s) => s.grid.size);
  const mode = useEditor((s) => s.mode);
  const erase = useInput((s) => s.erase);
  const pick = useInput((s) => s.pick);

  const modeLabel = pick
    ? 'Hút màu (giữ C)'
    : erase
      ? 'Xóa (giữ X)'
      : mode === 'remove'
        ? 'Xóa'
        : mode === 'paint'
          ? 'Sơn màu'
          : 'Đặt';

  return (
    <div className="hud">
      <div>
        <span className="hud-k">Ô</span>{' '}
        {hover ? `${hover[0]}, ${hover[1]}, ${hover[2]}` : '—'}
      </div>
      <div>
        <span className="hud-k">Khối</span> {count}
      </div>
      <div>
        <span className="hud-k">Chế độ</span> {modeLabel}
      </div>
    </div>
  );
}
