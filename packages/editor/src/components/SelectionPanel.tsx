import { useEffect, useMemo } from 'react';
import { useEditor } from '../store';
import { AXIS_X, AXIS_Y, AXIS_Z } from './axisColors';
import { useDrag } from './dragStore';
import { useHoverBlock } from './hoverStore';
import {
  clipRegionAt,
  copyRegion,
  countFilled,
  filledCells,
  regionSize,
  useSelection,
} from './selectionStore';
import type { Cell } from './Voxels';

/** Bấm phím tắt trong lúc đang gõ vào ô nhập liệu thì không tính. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Dời khối trong vùng chọn (và cả khung) đi một khoảng. `boxOnly`: chỉ dời khung. */
function moveBy(dx: number, dy: number, dz: number, boxOnly = false): void {
  const { region, shiftRegion } = useSelection.getState();
  if (!region) return;
  if (!boxOnly) {
    const cells = filledCells(region);
    if (cells.length) useEditor.getState().moveCells(cells, dx, dy, dz);
  }
  shiftRegion(dx, dy, dz);
}

function doCopy(): void {
  const { region, setClip } = useSelection.getState();
  if (!region) return;
  const clip = copyRegion(region);
  if (clip) setClip(clip);
}

/**
 * Dán cụm đã copy: góc nhỏ nhất của cụm đặt vào ô chuột đang trỏ. Không trỏ vào đâu
 * thì dán cạnh vùng chọn hiện tại theo trục X.
 */
function doPaste(): void {
  const { clip, region, setRegion } = useSelection.getState();
  if (!clip) return;
  const hovered = useHoverBlock.getState().target;
  const at: Cell = hovered
    ? [...hovered]
    : region
      ? [region.min[0] + clip.size[0], region.min[1], region.min[2]]
      : [0, 0, 0];
  useEditor.getState().pasteVoxels(clip.items, at);
  setRegion(clipRegionAt(clip, at));
}

/** Nhân bản vùng chọn sang ô liền kề theo trục, rồi chọn luôn bản mới để bấm tiếp. */
function doDuplicate(axis: 0 | 1 | 2): void {
  const { region, setRegion, setClip } = useSelection.getState();
  if (!region) return;
  const clip = copyRegion(region);
  if (!clip) return;
  const at: Cell = [...region.min];
  at[axis] += clip.size[axis];
  useEditor.getState().pasteVoxels(clip.items, at);
  setClip(clip);
  setRegion(clipRegionAt(clip, at));
}

function doDelete(): void {
  const region = useSelection.getState().region;
  if (!region) return;
  const cells = filledCells(region);
  if (cells.length) useEditor.getState().deleteCells(cells);
}

/**
 * Bảng thao tác cho vùng chọn + toàn bộ phím tắt của chế độ Chọn.
 * Luôn được mount (kể cả khi chưa có vùng chọn) để Ctrl+V dán được cụm đã copy
 * trước đó mà không cần quét lại vùng.
 */
export function SelectionPanel() {
  const mode = useEditor((s) => s.mode);
  const region = useSelection((s) => s.region);
  const clip = useSelection((s) => s.clip);
  const version = useEditor((s) => s.version);
  // Số khối trong vùng phải tính lại sau mỗi thao tác sửa grid, nên có `version`.
  const filled = useMemo(
    () => (region ? countFilled(region) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region, version],
  );

  // Đổi sang công cụ khác thì bỏ khung chọn: để lại một cái khung cam lửng lơ trong
  // lúc đang đặt khối chỉ gây hiểu lầm. Clipboard thì giữ, vẫn dán được.
  useEffect(() => {
    if (mode !== 'select') useSelection.getState().setRegion(null);
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // Mọi phím ở đây chỉ thuộc công cụ Chọn. Để nó chạy ở công cụ khác thì Delete
      // hay Ctrl+V bỗng sửa khối trong lúc người dùng tưởng mình đang vẽ.
      if (useEditor.getState().mode !== 'select') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;

      if (ctrl) {
        const lower = k.toLowerCase();
        if (lower === 'c') {
          doCopy();
        } else if (lower === 'v') {
          e.preventDefault();
          doPaste();
        } else if (lower === 'd') {
          e.preventDefault();
          doDuplicate(0);
        }
        return;
      }

      if (k === 'Escape') {
        // Đang kéo thì Esc là huỷ cú kéo (DragFill xử lý trước và preventDefault),
        // không phải bỏ vùng chọn.
        if (!useDrag.getState().drag && !e.defaultPrevented) {
          useSelection.getState().setRegion(null);
        }
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        doDelete();
        return;
      }
      // Mũi tên dời theo trục thế giới; giữ Shift để chỉ dời khung, khối đứng yên.
      const step = e.shiftKey;
      if (k === 'ArrowRight') moveBy(1, 0, 0, step);
      else if (k === 'ArrowLeft') moveBy(-1, 0, 0, step);
      else if (k === 'ArrowUp') moveBy(0, 1, 0, step);
      else if (k === 'ArrowDown') moveBy(0, -1, 0, step);
      else if (k === 'PageUp') moveBy(0, 0, 1, step);
      else if (k === 'PageDown') moveBy(0, 0, -1, step);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!region) return null;
  const [sx, sy, sz] = regionSize(region);

  const nudge = (label: string, color: string, axis: 0 | 1 | 2) => (
    <div className="sel-axis">
      <span className="sel-axis-name" style={{ color }}>
        {label}
      </span>
      <button
        onClick={() => moveBy(axis === 0 ? -1 : 0, axis === 1 ? -1 : 0, axis === 2 ? -1 : 0)}
        title={`Dời cụm khối theo ${label} một ô về phía âm`}
      >
        −
      </button>
      <button
        onClick={() => moveBy(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)}
        title={`Dời cụm khối theo ${label} một ô về phía dương`}
      >
        +
      </button>
      <button
        className="sel-dup"
        onClick={() => doDuplicate(axis)}
        title={`Nhân bản cụm sang liền kề theo ${label}`}
      >
        ⧉
      </button>
    </div>
  );

  return (
    <div className="sel-hud">
      <div className="sel-head">
        <b>Vùng chọn</b>
        <span className="sel-dim">
          {sx}×{sy}×{sz}
        </span>
        <span className="sel-dim">{filled} khối</span>
      </div>

      <div className="sel-axes">
        {nudge('X', AXIS_X, 0)}
        {nudge('Y', AXIS_Y, 1)}
        {nudge('Z', AXIS_Z, 2)}
      </div>

      <div className="sel-acts">
        <button onClick={doCopy} title="Copy cụm khối trong vùng (Ctrl+C)">
          Copy
        </button>
        <button
          onClick={doPaste}
          disabled={!clip}
          title="Dán vào ô chuột đang trỏ (Ctrl+V)"
        >
          Dán
        </button>
        <button className="tb-danger" onClick={doDelete} title="Xóa khối trong vùng (Delete)">
          Xóa khối
        </button>
        <button onClick={() => useSelection.getState().setRegion(null)} title="Bỏ chọn (Esc)">
          Bỏ chọn
        </button>
      </div>

      <div className="sel-hint">
        Mũi tên: dời X/Y • PageUp/Down: dời Z • giữ <b>Shift</b>: chỉ dời khung •{' '}
        <b>Ctrl+D</b>: nhân bản • <b>⧉</b>: nhân bản theo trục đó
      </div>
    </div>
  );
}
