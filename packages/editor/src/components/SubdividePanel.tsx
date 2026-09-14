import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_SUBDIVIDE_FACTOR, gridBounds, subdividedCount } from '@voxel/core';
import { useEditor } from '../store';

/** Trên mức này thì cảnh báo trước khi chia: scene vẫn dựng được nhưng bắt đầu ì tay. */
const HEAVY_BLOCKS = 30000;
/** Trần cứng — quá đây thì không cho bấm, vì dựng xong là tool đứng hình chứ không phải chậm. */
const MAX_BLOCKS = 300000;

interface SubdividePanelProps {
  onClose: () => void;
}

/**
 * Bảng "chia nhỏ khối": nhập số phần mỗi cạnh, mỗi khối thành n×n×n khối con.
 *
 * Dùng khi cần một level nhiều khối hơn (nhiều đạn hơn, phá lâu hơn) mà vẫn đúng hình đã dựng —
 * khác hẳn việc vẽ thêm khối, hình không xê dịch một ô nào.
 */
export function SubdividePanel({ onClose }: SubdividePanelProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const count = useEditor((s) => s.grid.size);
  const blasters = useEditor((s) => s.blasters);
  const levelMeta = useEditor((s) => s.levelMeta);
  const subdivide = useEditor((s) => s.subdivide);

  // Giữ dạng chuỗi để còn xoá trắng ô mà gõ lại, số thì đọc từ `factor`.
  const [text, setText] = useState('2');
  const [scaleBullets, setScaleBullets] = useState(true);
  const [scaleObjectScale, setScaleObjectScale] = useState(true);

  const parsed = Math.floor(Number(text));
  const factor =
    text.trim() && Number.isFinite(parsed) && parsed >= 2
      ? Math.min(MAX_SUBDIVIDE_FACTOR, parsed)
      : 0;

  const size = useMemo(() => {
    const b = gridBounds(grid);
    if (!b) return null;
    return { x: b.max.x - b.min.x + 1, y: b.max.y - b.min.y + 1, z: b.max.z - b.min.z + 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version]);

  const cube = factor ? factor ** 3 : 0;
  const nextCount = factor ? subdividedCount(count, factor) : 0;
  const bullets = blasters.reduce((sum, b) => sum + b.bulletCount, 0);
  const tooMany = nextCount > MAX_BLOCKS;
  const heavy = nextCount > HEAVY_BLOCKS;

  const run = () => {
    if (!factor || !count || tooMany) return;
    if (heavy && !confirm(`Sẽ dựng ${nextCount} khối — tool có thể giật khi xoay/sửa. Tiếp tục?`)) {
      return;
    }
    subdivide(factor, { scaleBullets, scaleObjectScale });
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal sd-modal">
        <div className="ex-head">
          <b>⧉ Chia nhỏ khối</b>
          <button className="tb-icon" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="ex-summary">
          Mỗi khối thành n×n×n khối con cùng màu. Hình giữ nguyên từng ô một, chỉ mịn hơn và nhiều
          khối hơn — cách tăng số khối mà không phải vẽ lại.
        </div>

        <div className="sd-fields">
          <label>
            <span>Số phần mỗi cạnh</span>
            <input
              type="number"
              min={2}
              max={MAX_SUBDIVIDE_FACTOR}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </label>
          <span className="sd-formula">
            {factor ? (
              <>
                1 khối → <b>{cube}</b> khối ({factor}×{factor}×{factor})
              </>
            ) : (
              <>nhập số nguyên từ 2 đến {MAX_SUBDIVIDE_FACTOR}</>
            )}
          </span>
        </div>

        <div className="sd-compare">
          <div className="sd-col">
            <div className="sd-col-label">Hiện tại</div>
            <div className="sd-col-num">{count} khối</div>
            {size && (
              <div className="sd-col-sub">
                {size.x}×{size.y}×{size.z} ô
              </div>
            )}
          </div>
          <div className="sd-arrow">→</div>
          <div className="sd-col">
            <div className="sd-col-label">Sau khi chia</div>
            <div className={`sd-col-num${tooMany ? ' sd-over' : ''}`}>
              {factor ? `${nextCount} khối` : '—'}
            </div>
            {size && factor && (
              <div className="sd-col-sub">
                {size.x * factor}×{size.y * factor}×{size.z * factor} ô
              </div>
            )}
          </div>
        </div>

        <div className="ex-section">Chỉnh kèm theo</div>
        <label className="ab-check">
          <input
            type="checkbox"
            checked={scaleBullets}
            disabled={!blasters.length}
            onChange={(e) => setScaleBullets(e.target.checked)}
          />
          <span>
            Nhân số đạn của súng ×{cube || 'n³'}
            {blasters.length ? (
              <>
                {' '}
                — {blasters.length} khẩu, {bullets} đạn → {factor ? bullets * cube : '…'} đạn
              </>
            ) : (
              <> — chưa có súng nào</>
            )}
          </span>
        </label>
        <div className="ab-hint">
          Tổng đạn mỗi màu phải bằng đúng số khối màu đó thì màn mới phá hết được. Số khối vừa
          ×{cube || 'n³'}, nên tắt ô này là bộ súng đang có thành thiếu đạn.
        </div>
        <label className="ab-check">
          <input
            type="checkbox"
            checked={scaleObjectScale}
            onChange={(e) => setScaleObjectScale(e.target.checked)}
          />
          <span>
            Chia objectScale cho {factor || 'n'} ({levelMeta.voxelizedObjectScale} →{' '}
            {factor ? Number((levelMeta.voxelizedObjectScale / factor).toFixed(6)) : '…'})
          </span>
        </label>
        <div className="ab-hint">
          Khối giờ dài gấp {factor || 'n'} lần theo mỗi cạnh (tính bằng ô), nên không thu nhỏ lại
          thì trong game nó phình to gấp {factor || 'n'} lần. Tâm khối cũng được nhân theo để chỗ
          đứng lúc xuất không đổi.
        </div>

        <div className="modal-note">
          depth ép tay ở bảng Xuất sẽ bị xoá: vỏ ngoài giờ dày {factor || 'n'} lớp nên depth cũ
          không còn trỏ đúng layer nào. Ctrl+Z hoàn tác được tất cả những thứ trên trong một lần.
        </div>

        {tooMany && (
          <div className="modal-err">
            {nextCount} khối là quá sức tool (trần {MAX_BLOCKS}). Giảm số phần mỗi cạnh xuống.
          </div>
        )}

        <div className="ab-actions">
          <button onClick={onClose}>Huỷ</button>
          <button className="bl-auto" disabled={!factor || !count || tooMany} onClick={run}>
            ⧉ Chia nhỏ
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
