import { useMemo, useState } from 'react';
import { useEditor } from '../store';

interface ColorLegendProps {
  /**
   * Nhúng vào bảng khác (bảng 🎨 Tô lớp) thay vì nổi trên scene: bỏ định vị fixed, bỏ nút thu gọn —
   * chip thu gọn vốn là fixed nên bấm vào trong bảng là nó nhảy ra giữa màn hình.
   */
  embedded?: boolean;
}

/** Bảng bên phải: liệt kê các màu đang dùng trong scene + số block, và lọc hiển thị. */
export function ColorLegend({ embedded = false }: ColorLegendProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const colorFilter = useEditor((s) => s.colorFilter);
  const toggleColorFilter = useEditor((s) => s.toggleColorFilter);
  const clearColorFilter = useEditor((s) => s.clearColorFilter);

  const [open, setOpen] = useState(true);

  // Đếm số block theo màu, sắp giảm dần.
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const { voxel } of grid.entries()) m.set(voxel.color, (m.get(voxel.color) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version]);

  if (!rows.length) return null;

  const total = rows.reduce((s, [, n]) => s + n, 0);
  const filtering = colorFilter.length > 0;

  if (!open && !embedded) {
    return (
      <button
        className={`color-legend legend-chip${filtering ? ' filtering' : ''}`}
        onClick={() => setOpen(true)}
        title="Mở bảng màu"
      >
        🎨 {rows.length}
      </button>
    );
  }

  return (
    <div className={`color-legend${embedded ? ' embedded' : ''}`}>
      <div className="legend-head">
        <span title={`${total} khối`}>{rows.length} màu</span>
        <span className="legend-head-actions">
          {filtering && (
            <button className="link-btn" onClick={clearColorFilter} title="Hiện lại tất cả">
              tất cả
            </button>
          )}
          {!embedded && (
            <button
              className="link-btn legend-collapse"
              onClick={() => setOpen(false)}
              title="Thu gọn bảng màu"
            >
              ›
            </button>
          )}
        </span>
      </div>
      <div className="legend-list">
        {rows.map(([color, n]) => {
          const active = colorFilter.includes(color);
          const dimmed = filtering && !active;
          return (
            <button
              key={color}
              className={`legend-row${active ? ' active' : ''}${dimmed ? ' dimmed' : ''}`}
              onClick={() => toggleColorFilter(color)}
              title={`${color} — ${n} khối (bấm để lọc, chọn nhiều màu được)`}
            >
              <span className="legend-swatch" style={{ background: color }} />
              <span className="legend-count">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
