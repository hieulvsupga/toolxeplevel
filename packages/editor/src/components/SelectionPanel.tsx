import { useEffect, useMemo, useState } from 'react';
import { WRAPPER_KINDS } from '@voxel/core';
import { useEditor } from '../store';
import { AXIS_X, AXIS_Y, AXIS_Z } from './axisColors';
import { rotateAroundCenter, type RotAxis, type RotDir } from '../lib/rotateCells';
import { useDrag } from './dragStore';
import { useHoverBlock } from './hoverStore';
import {
  clipRegionAt,
  copyCells,
  pickFromCells,
  copyRegion,
  countFilled,
  filledCells,
  livePickCells,
  regionSize,
  resizePickCells,
  useSelection,
} from './selectionStore';
import type { Cell } from './Voxels';

/**
 * Vùng chọn đang có hiệu lực, gộp hai kiểu: hộp 3D (`region`) và chọn 2D (`pick`, một tập ô rời).
 *
 * Mọi thao tác đều chạy trên DANH SÁCH Ô nên hai kiểu chọn dùng chung được hết; chỉ khác chỗ lấy
 * danh sách đó ở đâu: hộp thì quét lại các ô có khối trong hộp (nên khối mới vẽ thêm vào trong hộp
 * cũng được tính), còn chọn 2D thì lọc lại tập ô đã chốt lúc kéo khung.
 */
function activeCells(): Cell[] {
  const { pick, region } = useSelection.getState();
  if (pick) return livePickCells(pick);
  return region ? filledCells(region) : [];
}

/** Hộp bao của vùng chọn đang có hiệu lực — chỗ neo cho dán / nhân bản. */
function activeRegion() {
  const { pick, region } = useSelection.getState();
  return pick ? pick.region : region;
}

/** Ba trục dùng chung cho mọi hàng nút của bảng — nhãn, màu trục, chỉ số và khoá quay. */
const AXES = [
  { name: 'X', color: AXIS_X, index: 0 as const, key: 'x' as const },
  { name: 'Y', color: AXIS_Y, index: 1 as const, key: 'y' as const },
  { name: 'Z', color: AXIS_Z, index: 2 as const, key: 'z' as const },
];

/** Bấm phím tắt trong lúc đang gõ vào ô nhập liệu thì không tính. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Dời khối trong vùng chọn (và cả khung) đi một khoảng. `boxOnly`: chỉ dời khung. */
function moveBy(dx: number, dy: number, dz: number, boxOnly = false): void {
  const { shiftRegion } = useSelection.getState();
  if (!activeRegion()) return;
  if (!boxOnly) {
    const cells = activeCells();
    if (cells.length) useEditor.getState().moveCells(cells, dx, dy, dz);
  }
  shiftRegion(dx, dy, dz);
}

function doCopy(): void {
  const { pick, region, setClip } = useSelection.getState();
  // Chọn 2D: chỉ copy đúng các ô đã chọn, không lấy cả hộp bao — hộp bao của một tập ô rời có thể
  // trùm lên đủ thứ không được chọn.
  const clip = pick
    ? copyCells(livePickCells(pick), pick.region.min, regionSize(pick.region))
    : region
      ? copyRegion(region)
      : null;
  if (clip) setClip(clip);
}

/**
 * Dán cụm đã copy: góc nhỏ nhất của cụm đặt vào ô chuột đang trỏ. Không trỏ vào đâu
 * thì dán cạnh vùng chọn hiện tại theo trục X.
 */
function doPaste(): void {
  const { clip, setRegion } = useSelection.getState();
  if (!clip) return;
  const region = activeRegion();
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
  const { pick, setRegion, setClip } = useSelection.getState();
  const region = activeRegion();
  if (!region) return;
  const clip = pick
    ? copyCells(livePickCells(pick), pick.region.min, regionSize(pick.region))
    : copyRegion(region);
  if (!clip) return;
  const at: Cell = [...region.min];
  at[axis] += clip.size[axis];
  useEditor.getState().pasteVoxels(clip.items, at);
  setClip(clip);
  setRegion(clipRegionAt(clip, at));
}

/**
 * Quay cụm đang chọn 90° quanh một trục, gộp 1 undo.
 *
 * Phải tính trạng thái CUỐI của từng ô trước khi ghi (ô nguồn thành trống, rồi ô đích ghi đè lên):
 * vùng nguồn và vùng đích chồng nhau gần như luôn luôn, mà ghi hai lần vào cùng một ô thì bước undo
 * trả lại sai — xoá trước ghi sau, undo chạy theo thứ tự đó sẽ để lại ô trống.
 */
function doRotate(axis: RotAxis, dir: RotDir): void {
  const cells = activeCells();
  if (!cells.length) return;
  const res = rotateAroundCenter(cells, axis, dir);
  if (!res) return;

  const grid = useEditor.getState().grid;
  const targets = new Map<string, { x: number; y: number; z: number; color: string | null }>();
  const key = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;
  for (const [x, y, z] of cells) targets.set(key([x, y, z]), { x, y, z, color: null });
  for (const { from, to } of res.moved) {
    const color = grid.get(from[0], from[1], from[2])?.color;
    if (!color) continue;
    targets.set(key(to), { x: to[0], y: to[1], z: to[2], color });
  }
  useEditor.getState().applyCells([...targets.values()]);

  // Vùng chọn đi theo cụm, để quay tiếp / dời tiếp mà không phải chọn lại.
  const { pick, setPick, setRegion } = useSelection.getState();
  if (pick) setPick(pickFromCells(res.moved.map((m) => m.to)));
  else setRegion({ min: res.min, max: res.max });
}

/**
 * Nới / co HỘP CHỌN một ô theo một trục. Không đụng khối nào — chỉ đổi vùng đang chọn.
 *
 * `dir` +1 = nới ra, −1 = co vào. `atMin` chọn phía nào của hộp: kéo hộp mà thiếu một hàng thì hàng
 * thiếu nằm phía nào cũng có thể, nên phải với được cả hai phía (nút thường đụng phía max, giữ
 * Shift thì đụng phía min).
 *
 * Vùng chọn 2D là tập ô rời nên "nới" ở đó nghĩa khác: thêm các khối ở hàng kế tiếp vào tập đang
 * chọn — xem `resizePickCells`.
 */
function resizeBox(axis: 0 | 1 | 2, dir: -1 | 1, atMin: boolean): void {
  const { region, pick, setPick, setRegion } = useSelection.getState();
  if (pick) {
    setPick(pickFromCells(resizePickCells(pick, axis, dir, atMin)));
    return;
  }
  if (!region) return;
  const min = [...region.min] as Cell;
  const max = [...region.max] as Cell;
  if (atMin) min[axis] -= dir;
  else max[axis] += dir;
  // Hộp phải còn ít nhất một ô, không thì nó lật ngược.
  if (max[axis] < min[axis]) return;
  setRegion({ min, max });
}

function doDelete(): void {
  const cells = activeCells();
  if (cells.length) useEditor.getState().deleteCells(cells);
}

/**
 * Bảng thao tác cho vùng chọn + toàn bộ phím tắt của chế độ Chọn.
 * Luôn được mount (kể cả khi chưa có vùng chọn) để Ctrl+V dán được cụm đã copy
 * trước đó mà không cần quét lại vùng.
 */
export function SelectionPanel() {
  const mode = useEditor((s) => s.mode);
  const boxRegion = useSelection((s) => s.region);
  const pick = useSelection((s) => s.pick);
  const clip = useSelection((s) => s.clip);
  const version = useEditor((s) => s.version);
  const region = pick ? pick.region : boxRegion;
  // Số khối trong vùng phải tính lại sau mỗi thao tác sửa grid, nên có `version`.
  const filled = useMemo(
    () => (pick ? livePickCells(pick).length : boxRegion ? countFilled(boxRegion) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, boxRegion, version],
  );

  /**
   * Lớp bọc dựng ra ôm theo HÌNH KHỐI hay lấy CẢ HỘP.
   *
   * Mặc định bám khối: đó là cách data thật dựng mấy hình không phải hộp (Level_79 là quả cầu, chứ
   * không phải hộp 8×8×8 chứa quả cầu). Vẫn để chuyển sang cả hộp vì phần lớn level dùng hộp đặc, và
   * khối lớn thì nhiều khi muốn một cục vuông chằn chặn kể cả chỗ đang trống.
   */
  const [hugShape, setHugShape] = useState(true);

  // Đổi sang công cụ khác thì bỏ khung chọn: để lại một cái khung cam lửng lơ trong
  // lúc đang đặt khối chỉ gây hiểu lầm. Clipboard thì giữ, vẫn dán được.
  useEffect(() => {
    if (mode !== 'select' && mode !== 'select2d') {
      useSelection.setState({ region: null, pick: null });
    }
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // Mọi phím ở đây chỉ thuộc công cụ Chọn. Để nó chạy ở công cụ khác thì Delete
      // hay Ctrl+V bỗng sửa khối trong lúc người dùng tưởng mình đang vẽ.
      const toolMode = useEditor.getState().mode;
      if (toolMode !== 'select' && toolMode !== 'select2d') return;
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
          useSelection.setState({ region: null, pick: null });
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

  /**
   * Một hàng 3 cặp nút theo trục X / Y / Z, nhãn đặt trên dòng riêng.
   *
   * Nhãn trên dòng riêng để 6 nút dùng hết bề ngang panel: xếp nhãn cùng dòng thì mỗi nút chỉ còn
   * hơn 20px, không đủ chỗ cho "−X".
   */
  const axisRow = (
    label: string,
    labelTitle: string,
    make: (
      axis: 0 | 1 | 2,
      dir: -1 | 1,
    ) => {
      text: string;
      title: string;
      onClick: (e: React.MouseEvent) => void;
      disabled?: boolean;
    },
  ) => (
    <div className="sel-group">
      <span className="sel-group-name" title={labelTitle}>
        {label}
      </span>
      <div className="sel-rots">
        {AXES.map(({ name, color, index }) => (
          <span className="sel-rot-pair" key={name}>
            {([-1, 1] as const).map((dir) => {
              const b = make(index, dir);
              return (
                <button key={dir} onClick={b.onClick} disabled={b.disabled} title={b.title}>
                  {b.text}
                  <span style={{ color }}>{name}</span>
                </button>
              );
            })}
          </span>
        ))}
      </div>
    </div>
  );

  const delta = (axis: 0 | 1 | 2, dir: -1 | 1): [number, number, number] => [
    axis === 0 ? dir : 0,
    axis === 1 ? dir : 0,
    axis === 2 ? dir : 0,
  ];

  return (
    <div className="sel-hud">
      <div className="sel-head">
        <b>{pick ? 'Chọn 2D' : 'Vùng chọn'}</b>
        <span className="sel-dim" title={pick ? 'Hộp bao của các khối đã chọn' : 'Kích thước hộp chọn'}>
          {sx}×{sy}×{sz}
        </span>
        <span className="sel-dim">{filled} khối</span>
      </div>

      {axisRow(
        'Dời khối',
        'Dời cả cụm khối (khung đi theo) — cũng là phím mũi tên / PageUp-Down',
        (axis, dir) => ({
          text: dir < 0 ? '−' : '+',
          title: `Dời cụm khối một ô theo ${AXES[axis].name} phía ${dir < 0 ? 'âm' : 'dương'}`,
          onClick: () => moveBy(...delta(axis, dir)),
        }),
      )}

      {axisRow(
        'Dời khung',
        'Chỉ dời vùng đang chọn, khối đứng yên — cũng là Shift + mũi tên',
        (axis, dir) => ({
          text: dir < 0 ? '−' : '+',
          title:
            `Dời vùng chọn một ô theo ${AXES[axis].name} phía ${dir < 0 ? 'âm' : 'dương'} ` +
            `(khối không đi theo)`,
          onClick: () => moveBy(...delta(axis, dir), true),
        }),
      )}

      {axisRow(
        'Cỡ khung',
        'Nới / co vùng chọn một hàng. Nút thường làm ở phía dương, giữ Shift để làm ở phía âm',
        (axis, dir) => ({
          text: dir < 0 ? '−' : '+',
          title:
            (pick
              ? `${dir < 0 ? 'Bỏ' : 'Thêm'} một hàng khối theo ${AXES[axis].name} ` +
                `${dir < 0 ? 'khỏi' : 'vào'} vùng đang chọn`
              : `${dir < 0 ? 'Co' : 'Nới'} hộp chọn một ô theo ${AXES[axis].name}`) +
            ' (ở phía dương; giữ Shift để làm ở phía âm)',
          onClick: (e) => resizeBox(axis, dir, e.shiftKey),
        }),
      )}

      {/* Quay 90° quanh từng trục. Chỉ 90°: góc lẻ thì phải lấy mẫu lại lưới, hình ra rỗ lỗ và số
          khối đổi — mà số khối chính là điều kiện thắng của màn. */}
      {axisRow('Quay 90°', 'Quay cụm khối 90° quanh trục đó', (axis, dir) => ({
        text: dir < 0 ? '↻' : '↺',
        title:
          `Quay cụm 90° quanh trục ${AXES[axis].name} ` +
          `(${dir < 0 ? 'theo' : 'ngược'} chiều kim đồng hồ khi nhìn từ đầu dương của trục)`,
        onClick: () => doRotate(AXES[axis].key, dir),
      }))}

      <div className="sel-group">
        <span className="sel-group-name" title="Nhân bản cụm sang ô liền kề theo trục đó">
          Nhân bản
        </span>
        <div className="sel-rots">
          {AXES.map(({ name, color, index }) => (
            <button
              key={name}
              onClick={() => doDuplicate(index)}
              title={`Nhân bản cụm sang liền kề theo ${name} (Ctrl+D cho X)`}
            >
              ⧉<span style={{ color }}>{name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bọc cụm đang chọn: không cần công cụ riêng — quét vùng như thường rồi bấm. */}
      <div className="sel-group">
        <span
          className="sel-group-name"
          title="Biến cụm đang chọn thành lớp bọc — phải phá vỏ mới bắn được khối bên trong"
        >
          Bọc cụm đang chọn
        </span>
        <div className="sel-rots sel-hug">
          <button
            className={hugShape ? 'on' : ''}
            onClick={() => setHugShape(true)}
            title={
              `Bám khối: lớp bọc ôm ĐÚNG ${filled} ô đang có khối, ô trống trong hộp không tính. ` +
              `Dựng được hình bất kỳ — quả cầu, vỏ rỗng, hình chữ L. Hộp bao vẫn tự tính để ghi bounds.`
            }
          >
            ⬚ Bám khối
          </button>
          <button
            className={hugShape ? '' : 'on'}
            onClick={() => setHugShape(false)}
            title="Cả hộp: lớp bọc lấy trọn hộp chọn, kể cả ô đang trống — kiểu hộp đặc như trước."
          >
            ⬛ Cả hộp
          </button>
        </div>
        <div className="sel-rots">
          {WRAPPER_KINDS.map((k) => (
            <button
              key={k.kind}
              disabled={!filled}
              onClick={() => {
                if (!filled) return;
                const store = useEditor.getState();
                if (hugShape) {
                  const cells = activeCells().map(([x, y, z]) => ({ x, y, z }));
                  store.addWrapperFromCells(k.kind, cells);
                  return;
                }
                const r = activeRegion();
                if (!r) return;
                store.addWrapper(
                  k.kind,
                  { x: r.min[0], y: r.min[1], z: r.min[2] },
                  { x: r.max[0], y: r.max[1], z: r.max[2] },
                );
              }}
              title={
                !filled
                  ? 'Vùng chọn không có khối nào để bọc'
                  : `Bọc ${k.label} ${hugShape ? `ôm đúng ${filled} ô có khối` : 'trọn hộp chọn'}. ` +
                    `hp sửa ở danh sách lớp bọc góc dưới-trái.` +
                    (k.v1
                      ? ''
                      : ` — LƯU Ý: gameplay V1 chưa đọc ${k.field}, xuất ra game chưa có tác dụng.`)
              }
            >
              {k.icon} {k.label}
            </button>
          ))}
        </div>
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
        <button
          onClick={() => useSelection.setState({ region: null, pick: null })}
          title="Bỏ chọn (Esc)"
        >
          Bỏ chọn
        </button>
      </div>

      <div className="sel-hint">
        Mũi tên: dời X/Y • PageUp/Down: dời Z • giữ <b>Shift</b>: chỉ dời khung •{' '}
        <b>Ctrl+D</b>: nhân bản • hàng <b>Cỡ khung</b> giữ <b>Shift</b> để nới/co ở phía âm •{' '}
        quay 90° là quanh tâm cụm, 4 lần về chỗ cũ
      </div>
    </div>
  );
}
