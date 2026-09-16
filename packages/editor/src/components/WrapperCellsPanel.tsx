import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  WALL_HEX,
  cellKey,
  matchGameColor,
  wrapperCellSet,
  wrapperKindInfo,
  wrapperSize,
} from '@voxel/core';
import { useEditor } from '../store';

type Pos = { x: number; y: number; z: number };

/**
 * Cầu nối hai chiều giữa bảng liệt kê và scene.
 *
 * `cell` = ô đang trỏ TRONG BẢNG, `WrapperBoxes` đọc để soi nó trong scene.
 * `picked` = khối vừa BẤM TRONG SCENE, bảng đọc để nhảy tới đúng dòng đó.
 */
export const useCellFocus = create<{
  cell: Pos | null;
  picked: Pos | null;
  set: (cell: Pos | null) => void;
  setPicked: (cell: Pos | null) => void;
}>((set) => ({
  cell: null,
  picked: null,
  set: (cell) => set({ cell }),
  setPicked: (picked) => set({ picked }),
}));

const parseKey = (k: string) => {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
};

/**
 * Bảng LIỆT KÊ TỪNG Ô của một lớp bọc, bỏ được ô ra khỏi nó (hoặc cho vào lại).
 *
 * Bỏ một ô KHÔNG xoá khối: chỉ là lớp bọc thôi không trùm ô đó nữa. Với khối lớn thì khối ở đó quay
 * về làm khối thường — lại nằm trong `layers` và lại tốn đạn; với băng thì ô đó hết vỏ.
 *
 * Quét cả HỘP BAO chứ không chỉ các ô đang thuộc lớp bọc: ô đã bỏ vẫn phải hiện ra thì mới bấm cho
 * vào lại được — bỏ nhầm một ô mà không có đường lùi thì chỉ còn nước xoá cả lớp bọc dựng lại.
 */
export function WrapperCellsPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const wrappers = useEditor((s) => s.wrappers);
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const setWrapperCells = useEditor((s) => s.setWrapperCells);
  const w = wrappers.find((x) => x.id === id);

  const [onlyFilled, setOnlyFilled] = useState(true);
  const isolate = useEditor((s) => s.isolateWrapper);
  const setIsolate = useEditor((s) => s.setIsolateWrapper);
  const picked = useCellFocus((s) => s.picked);
  const listRef = useRef<HTMLDivElement>(null);

  // Đóng bảng thì trả scene về bình thường: để nguyên chế độ soi riêng mà bảng đã đóng thì người
  // dùng chỉ thấy level mất gần hết khối, chẳng biết đường nào mà lần.
  useEffect(
    () => () => {
      useCellFocus.getState().set(null);
      useCellFocus.getState().setPicked(null);
      useEditor.getState().setIsolateWrapper(null);
    },
    [],
  );

  // Bấm một khối trong scene -> cuộn tới đúng dòng của nó.
  useEffect(() => {
    if (!picked) return;
    listRef.current
      ?.querySelector(`[data-cell="${picked.x},${picked.y},${picked.z}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [picked]);

  const inner = useMemo(
    () => (w ? wrapperCellSet(w) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, wrappers],
  );

  const empties = useMemo(() => {
    const out: string[] = [];
    for (const k of inner) {
      const p = parseKey(k);
      if (!grid.has(p.x, p.y, p.z)) out.push(k);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inner, grid, version]);

  /** Toàn bộ ô của hộp bao, xếp x → y → z đúng thứ tự ghi ra file. */
  const rows = useMemo(() => {
    if (!w) return [];
    const out: { p: { x: number; y: number; z: number }; on: boolean; hex: string | null }[] = [];
    for (let x = w.min.x; x <= w.max.x; x++) {
      for (let y = w.min.y; y <= w.max.y; y++) {
        for (let z = w.min.z; z <= w.max.z; z++) {
          const voxel = grid.get(x, y, z);
          if (onlyFilled && !voxel) continue;
          out.push({ p: { x, y, z }, on: inner.has(`${x},${y},${z}`), hex: voxel?.color ?? null });
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, onlyFilled, inner, grid, version]);

  if (!w) return null;

  const size = wrapperSize(w);
  const volume = size.x * size.y * size.z;
  const info = wrapperKindInfo(w.kind);

  /** Ghi tập ô mới cho lớp bọc. Bỏ sạch thì không nhận — lớp bọc rỗng là data vô nghĩa. */
  const apply = (next: Set<string>) => {
    if (!next.size) return;
    setWrapperCells(w.id, [...next].map(parseKey));
  };

  const toggle = (p: { x: number; y: number; z: number }) => {
    const next = new Set(inner);
    const k = cellKey(p);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    apply(next);
  };

  /** Bỏ mọi ô trống: cách nhanh nhất biến hộp đặc thành lớp bọc ôm đúng hình khối đang có. */
  const dropEmpty = () => {
    const next = new Set(inner);
    for (const k of empties) next.delete(k);
    apply(next);
  };

  const fillBox = () => {
    const next = new Set<string>();
    for (let x = w.min.x; x <= w.max.x; x++) {
      for (let y = w.min.y; y <= w.max.y; y++) {
        for (let z = w.min.z; z <= w.max.z; z++) next.add(`${x},${y},${z}`);
      }
    }
    apply(next);
  };

  return (
    <div className="wrap-cells">
      <div className="layer-head">
        <span>
          {info.icon} {size.x}×{size.y}×{size.z} · {inner.size}/{volume} ô
        </span>
        <span className="legend-head-actions">
          <button className="link-btn legend-collapse" onClick={onClose} title="Đóng bảng">
            ✕
          </button>
        </span>
      </div>

      <div className="wrap-cells-bar">
        <label title="Ẩn các ô không có khối nào — chỉ còn danh sách khối thật bên trong">
          <input
            type="checkbox"
            checked={onlyFilled}
            onChange={(e) => setOnlyFilled(e.target.checked)}
          />
          chỉ ô có khối
        </label>
        <button
          className="link-btn"
          disabled={!empties.length}
          onClick={dropEmpty}
          title="Bỏ mọi ô trống khỏi lớp bọc — còn lại đúng hình các khối đang có"
        >
          bỏ {empties.length} ô trống
        </button>
        <button
          className="link-btn"
          disabled={!w.cells}
          onClick={fillBox}
          title="Cho lớp bọc trùm lại trọn hộp bao như ban đầu"
        >
          cả hộp
        </button>
      </div>

      <div className="wrap-cells-bar">
        <button
          className={`link-btn wrap-cells-solo${isolate === w.id ? ' on' : ''}`}
          onClick={() => setIsolate(isolate === w.id ? null : w.id)}
          title={
            'Ẩn hẳn mọi khối KHÔNG thuộc lớp bọc này, chỉ để lại khối của nó — rồi bấm vào một khối ' +
            'trong scene là bảng nhảy tới đúng dòng của ô đó. Chỉ là chuyện xem, không đụng tới data.'
          }
        >
          👁 {isolate === w.id ? 'đang chỉ hiện lớp này' : 'chỉ hiện lớp này'}
        </button>
      </div>

      <div className="wrap-cells-list" ref={listRef}>
        {rows.length === 0 && <div className="wrap-cells-none">Không có ô nào</div>}
        {rows.map(({ p, on, hex }) => (
          <label
            key={cellKey(p)}
            data-cell={cellKey(p)}
            className={`wrap-cell-row${on ? '' : ' off'}${
              picked && picked.x === p.x && picked.y === p.y && picked.z === p.z ? ' picked' : ''
            }`}
            onPointerEnter={() => useCellFocus.getState().set(p)}
            onPointerLeave={() => useCellFocus.getState().set(null)}
            title={on ? 'Đang thuộc lớp bọc — bỏ chọn để gỡ ra' : 'Đã gỡ khỏi lớp bọc — chọn để cho vào lại'}
          >
            <input type="checkbox" checked={on} onChange={() => toggle(p)} />
            <span className="wrap-cell-pos">
              {p.x}, {p.y}, {p.z}
            </span>
            <span className="wrap-cell-chip" style={{ background: hex ?? 'transparent' }} />
            <span className="wrap-cell-name">
              {hex ? (hex === WALL_HEX ? 'tường' : matchGameColor(hex).color.name) : 'trống'}
            </span>
          </label>
        ))}
      </div>

      <div className="wrap-cells-note">
        {isolate === w.id && 'Đang chỉ hiện khối của lớp bọc này — bấm vào một khối trong scene để nhảy tới dòng của nó. '}
        Bỏ ô chỉ gỡ ô đó khỏi lớp bọc, KHÔNG xoá khối.
        {info.hasColor
          ? ' Khối ở ô bị gỡ quay về làm khối thường — lại nằm trong layers và lại tốn đạn.'
          : ' Ô bị gỡ thì hết vỏ băng.'}
      </div>
    </div>
  );
}
