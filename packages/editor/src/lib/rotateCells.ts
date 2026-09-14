/**
 * Quay một cụm ô 90° quanh trục X / Y / Z.
 *
 * Chỉ 90° chứ không phải góc tuỳ ý: quay lưới voxel một góc lẻ thì phải lấy mẫu lại, hình ra rỗ lỗ
 * và số khối đổi — mà số khối là điều kiện thắng của màn. 90° là phép hoán vị toạ độ nên hình giữ
 * y nguyên, không mất một khối nào.
 */
import type { Cell } from '../components/Voxels';

export type RotAxis = 'x' | 'y' | 'z';
/** +1 = chiều dương của phép quay thuận phải (ngược kim đồng hồ khi nhìn từ đầu dương của trục). */
export type RotDir = 1 | -1;

export interface RotatedCell {
  from: Cell;
  to: Cell;
}

export interface RotateResult {
  moved: RotatedCell[];
  /** Hộp bao sau khi quay (min / max, hai đầu đều tính vào). */
  min: Cell;
  max: Cell;
}

/**
 * Mặt phẳng bị quay của từng trục, dạng (p, q) với +90° đưa p sang q — đúng phép quay thuận phải:
 * quanh X thì ŷ→ẑ, quanh Y thì ẑ→x̂, quanh Z thì x̂→ŷ.
 */
const PLANE: Record<RotAxis, [0 | 1 | 2, 0 | 1 | 2]> = {
  x: [1, 2],
  y: [2, 0],
  z: [0, 1],
};

/**
 * Quay cụm tại chỗ, giữ tâm hộp bao nếu giữ được, không thì neo góc nhỏ nhất.
 *
 * Điều kiện bắt buộc: quay 4 lần phải về ĐÚNG chỗ ban đầu, và ↺ rồi ↻ cũng vậy. Không có nó thì mỗi
 * lần bấm cụm trôi đi một ô, thử vài góc là hình chạy mất khỏi chỗ mình đặt.
 *
 * Mà tâm chỉ giữ được khi hai cạnh của mặt phẳng bị quay CÙNG CHẴN hoặc CÙNG LẺ: khác nhau thì tâm
 * mới lệch nửa ô, làm tròn kiểu gì cũng trôi (làm tròn luôn nghiêng về một phía nên 4 lần quay cộng
 * lại thành lệch cả ô). Trường hợp đó neo góc nhỏ nhất của hộp bao — cụm xoay quanh góc nên có xê
 * dịch, nhưng xê dịch ĐÚNG và quay tiếp vẫn về được chỗ cũ; lệch thì dùng mũi tên dời lại.
 */
export function rotateAroundCenter(cells: Cell[], axis: RotAxis, dir: RotDir): RotateResult | null {
  if (!cells.length) return null;

  const min: Cell = [...cells[0]];
  const max: Cell = [...cells[0]];
  for (const c of cells) {
    for (let i = 0; i < 3; i++) {
      if (c[i] < min[i]) min[i] = c[i];
      if (c[i] > max[i]) max[i] = c[i];
    }
  }
  const size: Cell = [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];

  const [p, q] = PLANE[axis];
  const newSize: Cell = [...size];
  newSize[p] = size[q];
  newSize[q] = size[p];

  // Giữ tâm được hay không, xem chú thích của hàm. Trục ngoài mặt phẳng quay thì cỡ không đổi nên
  // công thức dưới ra đúng min cũ.
  const centerable = (size[p] - size[q]) % 2 === 0;
  const newMin: Cell = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    newMin[i] = centerable ? min[i] + (size[i] - newSize[i]) / 2 : min[i];
  }

  const moved: RotatedCell[] = cells.map((from) => {
    const rel: Cell = [from[0] - min[0], from[1] - min[1], from[2] - min[2]];
    const out: Cell = [...rel];
    if (dir === 1) {
      out[p] = size[q] - 1 - rel[q];
      out[q] = rel[p];
    } else {
      out[p] = rel[q];
      out[q] = size[p] - 1 - rel[p];
    }
    return {
      from,
      to: [out[0] + newMin[0], out[1] + newMin[1], out[2] + newMin[2]] as Cell,
    };
  });

  return {
    moved,
    min: newMin,
    max: [newMin[0] + newSize[0] - 1, newMin[1] + newSize[1] - 1, newMin[2] + newSize[2] - 1],
  };
}
