import { useMemo, useState } from 'react';
import { recenterOffset } from '@voxel/core';
import { useEditor } from '../store';

/** Điều khiển "center" = gốc toạ độ khi xuất .asset. Gọn: ẩn/hiện, đặt tay X/Y/Z, tự căn. */
export function CenterPanel() {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const recenter = useEditor((s) => s.recenter);
  const centerOverride = useEditor((s) => s.centerOverride);
  const setCenterOverride = useEditor((s) => s.setCenterOverride);
  const showCenter = useEditor((s) => s.showCenter);
  const toggleShowCenter = useEditor((s) => s.toggleShowCenter);

  const [open, setOpen] = useState(true);

  const off = useMemo(
    () => recenterOffset(grid, recenter, centerOverride),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version, recenter, centerOverride],
  );

  const manual = centerOverride !== null;

  const setAxis = (axis: 'x' | 'y' | 'z', value: string) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return;
    setCenterOverride({ ...off, [axis]: n });
  };

  if (!open) {
    return (
      <button className="center-panel center-chip" onClick={() => setOpen(true)} title="Mở tâm">
        ◎
      </button>
    );
  }

  return (
    <div className="center-panel">
      <div className="center-head">
        <span>◎ Tâm</span>
        <span className="legend-head-actions">
          <input
            type="checkbox"
            className="layer-check"
            checked={showCenter}
            onChange={toggleShowCenter}
            title={showCenter ? 'Ẩn marker' : 'Hiện marker'}
          />
          <button className="link-btn legend-collapse" onClick={() => setOpen(false)} title="Thu gọn">
            ‹
          </button>
        </span>
      </div>

      <div className="center-xyz">
        {(['x', 'y', 'z'] as const).map((ax) => (
          <label key={ax}>
            {ax.toUpperCase()}
            <input
              className="num"
              type="number"
              step={1}
              value={off[ax]}
              onChange={(e) => setAxis(ax, e.target.value)}
            />
          </label>
        ))}
      </div>

      <button
        className="center-auto"
        onClick={() => setCenterOverride(null)}
        disabled={!manual}
        title="Đưa tâm về đúng tâm hộp bao các khối"
      >
        {manual ? '⌖ Về tâm hộp bao' : '⌖ Tự động (tâm hộp bao)'}
      </button>
    </div>
  );
}
