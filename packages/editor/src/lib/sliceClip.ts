/**
 * Copy / dán cả một TẦNG trong bảng 🎨 Tô lớp.
 *
 * Để riêng khỏi component vì đây là phần đụng vào data: dán sai một ô là level lệch mà nhìn lưới
 * không thấy gì, nên nó phải kiểm được bằng test chứ không chỉ bằng mắt.
 */

/** Trạng thái một ô của tầng đích. */
export interface CellState {
  /** Màu khối đang có, null = ô trống. */
  color: string | null;
  /** Khối đang bị ẩn (layer tắt / lọc màu) — không được chạm tới. */
  hidden: boolean;
}

/**
 * Một tầng đã copy. Lưu theo CHỈ SỐ LƯỚI (r * cols + c) chứ không phải toạ độ thế giới: hai trục
 * của lưới đổi theo hướng cắt, nên lưu chỉ số là dán vào tầng nào cũng đúng chỗ, miễn cùng hướng.
 */
export interface SliceClip {
  /** Trục đang cắt lúc copy — dán sang trục khác thì lưới là mặt phẳng khác, không dùng lại được. */
  axis: 'x' | 'y' | 'z';
  /** Tầng nguồn, chỉ để hiện nhãn cho biết đang giữ cái gì. */
  slice: number;
  cols: number;
  rows: number;
  /** null = ô trống, hoặc ô đang bị ẩn lúc copy (copy đúng thứ nhìn thấy). */
  cells: (string | null)[];
  /** Số ô có khối. */
  count: number;
}

/** Ô cần ghi khi dán: `color` = màu mới, null = xoá. Khớp tham số của `EditorState.applyCells`. */
export interface PasteTarget {
  x: number;
  y: number;
  z: number;
  color: string | null;
}

/**
 * Chụp tầng đang xem. Khối đang bị ẩn KHÔNG được copy: copy đúng thứ đang nhìn thấy, không thì dán
 * ra một tầng có cả khối mình không biết là mình đã copy.
 */
export function copySlice(opts: {
  axis: SliceClip['axis'];
  slice: number;
  cols: number;
  rows: number;
  stateAt: (c: number, r: number) => CellState;
}): SliceClip {
  const { axis, slice, cols, rows, stateAt } = opts;
  const cells: (string | null)[] = new Array(cols * rows).fill(null);
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const st = stateAt(c, r);
      if (!st.color || st.hidden) continue;
      cells[r * cols + c] = st.color;
      count++;
    }
  }
  return { axis, slice, cols, rows, cells, count };
}

/** Tầng đã copy có dán được vào lưới hiện tại không (cùng hướng cắt, cùng cỡ lưới). */
export function canPasteSlice(
  clip: SliceClip | null,
  axis: SliceClip['axis'],
  cols: number,
  rows: number,
): boolean {
  return !!clip && clip.axis === axis && clip.cols === cols && clip.rows === rows;
}

/**
 * Danh sách ô cần ghi để dán `clip` vào tầng đang xem: tầng đích thành Y HỆT tầng đã copy — sơn ô
 * có màu, thêm ô còn trống, XOÁ ô dư.
 *
 * Bỏ qua ô đang bị ẩn, giống mọi thao tác khác trong bảng: không sửa thứ mình không thấy. Ô nào vốn
 * đã đúng màu thì không đưa vào danh sách, nên dán trùng lên chính nó là không có việc gì xảy ra
 * (và không đẻ ra một bước undo rỗng).
 */
export function slicePasteTargets(
  clip: SliceClip,
  opts: {
    cols: number;
    rows: number;
    cellAt: (c: number, r: number) => [number, number, number];
    stateAt: (c: number, r: number) => CellState;
  },
): PasteTarget[] {
  const { cols, rows, cellAt, stateAt } = opts;
  const targets: PasteTarget[] = [];
  if (clip.cols !== cols || clip.rows !== rows) return targets;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const want = clip.cells[r * cols + c];
      const st = stateAt(c, r);
      if (st.hidden) continue;
      const [x, y, z] = cellAt(c, r);
      if (want) {
        if (st.color !== want) targets.push({ x, y, z, color: want });
      } else if (st.color !== null) {
        targets.push({ x, y, z, color: null });
      }
    }
  }
  return targets;
}
