import { useMemo, useState } from 'react';
import { validateWrappers, wrapperInnerCells, wrapperKindInfo, wrapperSize } from '@voxel/core';
import { useEditor } from '../store';
import { useSelection } from './selectionStore';

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
  const showWrappers = useEditor((s) => s.showWrappers);
  const toggleShowWrappers = useEditor((s) => s.toggleShowWrappers);
  const focused = useEditor((s) => s.focusedWrapper);
  const setFocused = useEditor((s) => s.setFocusedWrapper);

  /**
   * Dòng đã BẤM (soi cố định). Trỏ chuột qua dòng nào cũng soi dòng đó, nhưng rời chuột thì quay về
   * dòng đã bấm — không có cái chốt này thì vừa đưa chuột đi là hết sáng, đúng lúc muốn nhìn.
   */
  const [sticky, setSticky] = useState<number | null>(null);

  const rows = useMemo(
    () =>
      wrappers.map((w) => ({
        w,
        size: wrapperSize(w),
        inner: wrapperInnerCells(grid, w).length,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wrappers, grid, version],
  );

  const counts = useMemo(
    () => ({
      ice: wrappers.filter((w) => w.kind === 'ice').length,
      shield: wrappers.filter((w) => w.kind === 'shield').length,
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
          {counts.ice > 0 && counts.shield > 0 && ' · '}
          {counts.shield > 0 && `🛡 ${counts.shield}`} lớp bọc
        </span>
        <span className="legend-head-actions">
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
            <button
              className="link-btn wrap-kind"
              onClick={(e) => {
                e.stopPropagation();
                // Đổi loại tại chỗ: hai loại cùng một khuôn data nên đổi qua lại không mất gì, và
                // dựng nhầm loại thì khỏi phải xoá đi bọc lại.
                updateWrapper(w.id, { kind: w.kind === 'ice' ? 'shield' : 'ice' });
              }}
              title={`${wrapperKindInfo(w.kind).label} — bấm để đổi sang ${
                w.kind === 'ice' ? 'Shield' : 'Băng'
              }`}
            >
              {wrapperKindInfo(w.kind).icon}
            </button>
            <span className="wrap-size">
              {size.x}×{size.y}×{size.z}
            </span>
            <span className="wrap-inner" title={`${inner} khối nằm trong hộp`}>
              {inner} khối
            </span>
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
              className="link-btn layer-del"
              onClick={(e) => {
                e.stopPropagation();
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
