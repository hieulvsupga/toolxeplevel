import { useMemo, useState } from 'react';
import {
  GAME_COLORS,
  WALL_COLOR_ID,
  gameColorById,
  validateWrappers,
  wrapperFilledCount,
  wrapperKindInfo,
  wrapperSize,
} from '@voxel/core';
import { useEditor } from '../store';
import { useSelection } from './selectionStore';
import { WrapperCellsPanel } from './WrapperCellsPanel';

/**
 * Danh sách LỚP BỌC (góc dưới-trái). Mỗi dòng là một hộp: cỡ hộp, số khối bên trong, hp sửa ngay
 * trên dòng, nút chọn lại hộp và nút xoá.
 *
 * Có danh sách riêng vì lớp bọc không phải một khối nào cả — không nhìn thấy nó trong danh sách
 * layer, mà trong scene thì chỉ là một cái khung; không liệt kê ra thì dựng xong chẳng còn cách nào
 * biết level đang có mấy lớp bọc và hp bao nhiêu.
 */
export function WrapperListPanel() {
  const wrappers = useEditor((s) => s.wrappers);
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const updateWrapper = useEditor((s) => s.updateWrapper);
  const removeWrapper = useEditor((s) => s.removeWrapper);
  const setWrapperBrush = useEditor((s) => s.setWrapperBrush);
  const showWrappers = useEditor((s) => s.showWrappers);
  const toggleShowWrappers = useEditor((s) => s.toggleShowWrappers);
  const focused = useEditor((s) => s.focusedWrapper);
  const setFocused = useEditor((s) => s.setFocusedWrapper);

  /**
   * Dòng đã BẤM (soi cố định). Trỏ chuột qua dòng nào cũng soi dòng đó, nhưng rời chuột thì quay về
   * dòng đã bấm — không có cái chốt này thì vừa đưa chuột đi là hết sáng, đúng lúc muốn nhìn.
   */
  const [sticky, setSticky] = useState<number | null>(null);
  /** Lớp bọc đang mở bảng liệt kê ô. Mỗi lần một cái — mở hai bảng cùng lúc chỉ chật góc màn hình. */
  const [listing, setListing] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      wrappers.map((w) => ({
        w,
        size: wrapperSize(w),
        inner: wrapperFilledCount(grid, w),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wrappers, grid, version],
  );

  const counts = useMemo(
    () => ({
      ice: wrappers.filter((w) => w.kind === 'ice').length,
      large: wrappers.filter((w) => w.kind === 'largeVoxel').length,
    }),
    [wrappers],
  );

  const problems = useMemo(
    () => validateWrappers(grid, wrappers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wrappers, grid, version],
  );

  // Thu gọn là ẩn HẲN, không để lại chip: góc dưới-trái còn phải chừa chỗ cho dòng gợi ý phím tắt.
  // Bật lại bằng nút 🧊 trên toolbar.
  if (!wrappers.length || !showWrappers) return null;

  return (
    <div className="wrap-list">
      <div className="layer-head">
        <span>
          {counts.ice > 0 && `🧊 ${counts.ice}`}
          {counts.ice > 0 && counts.large > 0 && ' · '}
          {counts.large > 0 && `🟪 ${counts.large}`} lớp bọc
        </span>
        <span className="legend-head-actions">
          {listing !== null && <WrapperCellsPanel id={listing} onClose={() => setListing(null)} />}

      {problems.length > 0 && (
            <span className="wrap-warn" title={problems.join('\n')}>
              ⚠ {problems.length}
            </span>
          )}
          <button
            className="link-btn legend-collapse"
            onClick={toggleShowWrappers}
            title="Ẩn bảng này (bật lại bằng nút 🧊 trên toolbar)"
          >
            ✕
          </button>
        </span>
      </div>

      <div className="layer-rows">
        {rows.map(({ w, size, inner }) => (
          <div
            className={`wrap-row${focused === w.id ? ' on' : ''}`}
            key={w.id}
            onPointerEnter={() => setFocused(w.id)}
            onPointerLeave={() => setFocused(sticky)}
            onClick={() => {
              const next = sticky === w.id ? null : w.id;
              setSticky(next);
              setFocused(next);
            }}
            title="Bấm để soi sáng lớp bọc này trong scene (bấm lại để thôi)"
          >
            <button
              className="link-btn wrap-pick"
              // Chọn lại hộp = đưa nó thành vùng chọn: sửa hộp thì kéo vùng chọn mới rồi bấm 🧊
              // lần nữa, khỏi phải có thêm một bộ công cụ kéo riêng cho lớp bọc.
              onClick={(e) => {
                e.stopPropagation();
                useSelection.getState().setRegion({
                  min: [w.min.x, w.min.y, w.min.z],
                  max: [w.max.x, w.max.y, w.max.z],
                });
              }}
              title="Chọn lại hộp này (thành vùng chọn) để xem / dựa vào đó kéo hộp mới"
            >
              ⬚
            </button>
            {/* Icon loại chỉ để NHÌN, không bấm được: nó nằm ngay cạnh mấy nút khác nên rất dễ
                bấm nhầm, mà bấm nhầm là lớp bọc đổi hẳn loại — băng thành khối lớn thì cụm khối
                bên trong biến mất khỏi layers và bảng đạn nhảy số. Đổi loại thì xoá đi bọc lại. */}
            <span className="wrap-kind" title={wrapperKindInfo(w.kind).label}>
              {wrapperKindInfo(w.kind).icon}
            </span>
            {/* Hình riêng thì phải nói ra: cỡ hộp bao một mình nó không tả đúng lớp bọc nữa —
                8×8×8 có thể là cục vuông 512 ô mà cũng có thể là quả cầu 416 ô. */}
            <span
              className="wrap-size"
              title={
                w.cells
                  ? `Hộp bao ${size.x}×${size.y}×${size.z}, hình riêng ${w.cells.length}/${
                      size.x * size.y * size.z
                    } ô`
                  : `Hộp đặc ${size.x}×${size.y}×${size.z}`
              }
            >
              {size.x}×{size.y}×{size.z}
              {w.cells && <span className="wrap-shape">·{w.cells.length}</span>}
            </span>
            {/* Khối lớn mang đúng MỘT màu, nên chỗ này là ô chọn màu thay cho số khối (số khối
                chuyển vào tooltip). Băng thì không có field màu. */}
            {wrapperKindInfo(w.kind).hasColor ? (
              <select
                className="wrap-color"
                value={w.color ?? 1}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const color = Number(e.target.value);
                  updateWrapper(w.id, { color });
                  // Nhớ luôn làm màu cho lần đặt sau: bỏ bảng thông số rồi nên đây là chỗ duy nhất
                  // chọn màu — đổi một cái rồi đặt tiếp là ra đúng màu đó, khỏi sửa từng dòng.
                  setWrapperBrush({ color });
                }}
                title={`Màu của khối lớn · ${inner} khối nằm trong hộp`}
                style={{ color: gameColorById(w.color ?? 1)?.hex }}
              >
                {/* Mỗi dòng mang đúng màu của nó: đặt màu ở thẻ select thôi thì cả danh sách đổ ra
                    đều một màu — màu đang chọn — nên mở ra chẳng phân biệt được dòng nào là dòng
                    nào. */}
                {GAME_COLORS.filter((c) => c.id !== WALL_COLOR_ID).map((c) => (
                  <option key={c.id} value={c.id} style={{ color: c.hex, background: '#22222a' }}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="wrap-inner" title={`${inner} khối nằm trong hộp`}>
                {inner} khối
              </span>
            )}
            <label
              className="wrap-hp"
              title="Số lần phá mới vỡ vỏ"
              onClick={(e) => e.stopPropagation()}
            >
              hp
              <input
                type="number"
                min={1}
                value={w.hp}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (e.target.value.trim() && Number.isFinite(n) && n >= 1) {
                    updateWrapper(w.id, { hp: Math.floor(n) });
                  }
                }}
              />
            </label>
            <button
              className="link-btn wrap-cells-open"
              onClick={(e) => {
                e.stopPropagation();
                const next = listing === w.id ? null : w.id;
                setListing(next);
                // Mở bảng thì chốt sáng luôn lớp bọc đó: đang soi từng ô của nó mà trong scene lại
                // không biết nó nằm đâu thì bảng chẳng giúp được gì.
                setSticky(next);
                setFocused(next);
              }}
              title="Liệt kê từng ô bên trong — bỏ bớt ô để lớp bọc thành hình khác hộp"
            >
              ☰
            </button>
            <button
              className="link-btn layer-del"
              onClick={(e) => {
                e.stopPropagation();
                if (listing === w.id) setListing(null);
                removeWrapper(w.id);
              }}
              title="Bỏ lớp bọc này (khối bên trong không bị xoá)"
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <div className="wrap-problems">
          {problems.map((p) => (
            <div key={p}>• {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}
