import { VoxelGrid } from './VoxelGrid';
import { WALL_HEX, matchGameColor } from './gameColors';
import { blockCountsByColor } from './blasters';
import { recenterOffset, type BuildLayersOptions } from './layers';
import type { Vec3 } from './types';

/**
 * LỚP BỌC dạng hộp — cơ chế bọc một khối hộp voxel lại, phải phá vỏ mới bắn được phần trong.
 *
 * Data của game có cả một họ cơ chế cùng một khuôn (`bounds` + `hp` + `hpTexts` +
 * `innerVoxelPositions`): IceWrapper, LargeVoxel, Shield, GiftWrapper, ColorBox, Playpen… Ở đây
 * dựng hai loại, chung một đường vì chỉ khác nhau hai chỗ:
 *
 *  - ghi vào mảng nào trong file (`iceWrapperData` / `largeVoxelData`);
 *  - `LargeVoxelData` có thêm `colorType` — màu của khối lớn — và field đó đứng TRƯỚC `bounds`
 *    trong khai báo C#, nên khi ghi YAML phải đúng thứ tự đó (Unity ghi theo thứ tự field).
 *
 * LƯU Ý: `LevelData.cs` chỉ ghi `iceWrapperData` là "V1-relevant"; `largeVoxelData` nằm dưới
 * "Extensibility placeholders — not acted on by V1 gameplay code". Tool xuất đúng data, nhưng game
 * V1 chưa đọc — `validateWrappers` nhắc lại để không ai tưởng đã thử được.
 */
export type WrapperKind = 'ice' | 'largeVoxel';

/** Bảng loại lớp bọc: nhãn cho UI + tên mảng tương ứng trong file .asset. */
export const WRAPPER_KINDS: {
  kind: WrapperKind;
  icon: string;
  label: string;
  field: string;
  /** Loại này có field `colorType` không (khối lớn mang đúng một màu). */
  hasColor: boolean;
  /** Gameplay V1 có chạy loại này không. */
  v1: boolean;
}[] = [
  { kind: 'ice', icon: '🧊', label: 'Băng', field: 'iceWrapperData', hasColor: false, v1: true },
  {
    kind: 'largeVoxel',
    icon: '🟪',
    label: 'Khối lớn',
    field: 'largeVoxelData',
    hasColor: true,
    v1: false,
  },
];

export function wrapperKindInfo(kind: WrapperKind) {
  return WRAPPER_KINDS.find((k) => k.kind === kind) ?? WRAPPER_KINDS[0];
}

/** Một lớp bọc, theo Ô LƯỚI của editor, hai đầu đều tính vào vùng (như `Region`). */
export interface BoxWrapper {
  id: number;
  kind: WrapperKind;
  min: Vec3;
  max: Vec3;
  /** Số lần phá mới vỡ vỏ. */
  hp: number;
  /** `ColorType` của khối lớn. Chỉ loại có `hasColor` dùng tới; loại khác bỏ trống. */
  color?: number;
  /**
   * HÌNH THẬT của lớp bọc: đúng những ô nó chiếm, khi lớp bọc KHÔNG đặc kín cả hộp.
   *
   * `undefined` = đặc kín (mọi ô từ `min` tới `max`) — ca thường gặp: 534/536 khối lớn và 74/75
   * băng trong data thật đúng như vậy. Nhưng game có dựng cả hình khác:
   *
   *  - Level_79: khối lớn hộp 8×8×8 mà inner chỉ 416 ô — một QUẢ CẦU, mặt cắt tròn 52 ô kéo dài 8
   *    lát. 72 ô còn thừa trong hộp vẫn là khối thường nằm nguyên trong `layers`.
   *  - Level_393: băng hộp 12×13×12 mà inner 772 ô — đúng bề mặt hộp, tức một cái VỎ RỖNG
   *    (1872 − ruột 10×11×10 = 772).
   *
   * `min`/`max` luôn là HỘP BAO của tập ô này (`bounds` trong file tính từ đó), nên hai thứ phải
   * dựng cùng lúc — xem `wrapperFromCells`.
   *
   * Xếp theo x → y → z tăng dần, đúng thứ tự mọi file mẫu ghi (611/611).
   */
  cells?: Vec3[];
}

/** `Bounds` của Unity: tâm + NỬA kích thước (đúng nghĩa `Bounds.extents`). */
export interface WrapperBounds {
  center: Vec3;
  extent: Vec3;
}

/** Một `HpTextData`: dán số HP lên một mặt hộp. */
export interface HpText {
  position: Vec3;
  /** Pháp tuyến mặt — chữ nhìn ra hướng này. */
  direction: Vec3;
  /** Chiều đứng của chữ. */
  up: Vec3;
}

/** Một phần tử của `iceWrapperData` / `largeVoxelData` (cả họ cơ chế cùng khuôn). */
export interface WrapperEntry {
  kind: WrapperKind;
  /** Chỉ loại khối lớn có — và trong file nó phải đứng TRƯỚC `bounds`. */
  colorType?: number;
  bounds: WrapperBounds;
  hp: number;
  hpTexts: HpText[];
  innerVoxelPositions: Vec3[];
}

export const DEFAULT_WRAPPER_HP = 3;

export function nextWrapperId(wrappers: BoxWrapper[]): number {
  let max = 0;
  for (const w of wrappers) max = Math.max(max, w.id);
  return max + 1;
}

/** Khoá một ô để bỏ vào Set — chỗ nào cũng phải dùng chung một dạng khoá. */
export const cellKey = (p: Vec3): string => `${p.x},${p.y},${p.z}`;

/** Tập ô của lớp bọc, dạng Set để tra nhanh. */
export function wrapperCellSet(w: BoxWrapper): Set<string> {
  return new Set(wrapperInnerCells(w).map(cellKey));
}

/** Hộp bao của một tập ô. Tập rỗng thì không có hộp nào. */
export function cellsAabb(cells: Vec3[]): { min: Vec3; max: Vec3 } | null {
  if (!cells.length) return null;
  const min = { ...cells[0] };
  const max = { ...cells[0] };
  for (const p of cells) {
    min.x = Math.min(min.x, p.x); max.x = Math.max(max.x, p.x);
    min.y = Math.min(min.y, p.y); max.y = Math.max(max.y, p.y);
    min.z = Math.min(min.z, p.z); max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

/**
 * Dựng lớp bọc từ ĐÚNG những ô cho trước (hình bất kỳ): hộp bao tự tính, tập ô được bỏ trùng và
 * xếp x → y → z.
 *
 * Nếu tập ô lấp kín cả hộp bao thì KHÔNG lưu `cells` — để ca thường gặp giữ nguyên dạng cũ, và để
 * so sánh / xuất file không phải mang theo danh sách dài vô ích.
 */
export function wrapperFromCells(
  base: Omit<BoxWrapper, 'min' | 'max' | 'cells'>,
  cells: Vec3[],
): BoxWrapper | null {
  const seen = new Set<string>();
  const uniq: Vec3[] = [];
  for (const p of cells) {
    const k = cellKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ x: p.x, y: p.y, z: p.z });
  }
  const box = cellsAabb(uniq);
  if (!box) return null;
  uniq.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  const volume =
    (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1);
  return {
    ...base,
    min: box.min,
    max: box.max,
    ...(uniq.length === volume ? null : { cells: uniq }),
  };
}

/** Số ô của hộp theo từng trục. */
export function wrapperSize(w: BoxWrapper): Vec3 {
  return {
    x: w.max.x - w.min.x + 1,
    y: w.max.y - w.min.y + 1,
    z: w.max.z - w.min.z + 1,
  };
}

/**
 * `Bounds` của hộp.
 *
 * Một voxel là cube 1×1×1 mà toạ độ nguyên là TÂM cube (căn cứ: file của game — Banana chạy x
 * −3..3, z −12..12, đối xứng quanh 0 với số ô lẻ), nên ô `p` chiếm khoảng `p−0.5 … p+0.5`. Vì thế
 * extent phải cộng thêm nửa ô ở mỗi đầu: `(max − min + 1) / 2`, KHÔNG phải `(max − min) / 2`.
 * Thiếu nửa ô đó thì hộp trong game hụt đúng một ô so với cụm khối nó bọc.
 */
export function wrapperBounds(w: BoxWrapper): WrapperBounds {
  const size = wrapperSize(w);
  return {
    center: {
      x: (w.min.x + w.max.x) / 2,
      y: (w.min.y + w.max.y) / 2,
      z: (w.min.z + w.max.z) / 2,
    },
    extent: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
  };
}

/**
 * `innerVoxelPositions`: các ô lớp bọc CHIẾM.
 *
 * Lớp bọc có hình riêng (`cells`) thì lấy đúng hình đó; không thì là TOÀN BỘ ô của hộp, kể cả ô
 * trống.
 *
 * Đo trên data thật của game (Data/DataExample2): 608/611 lớp bọc có đúng số phần tử bằng thể tích
 * hộp, và 558 lớp trong đó liệt kê cả những ô mà `layers` không có khối nào. Tức đây là "vùng lớp
 * bọc chiếm", không phải "các khối bị bọc" — liệt kê thiếu là game hiểu vùng bọc nhỏ hơn thật. Ba
 * ca lệch còn lại là hình có chủ ý (quả cầu, vỏ rỗng) — xem `BoxWrapper.cells`.
 *
 * Thứ tự x → y → z tăng dần, khớp thứ tự trong mọi file mẫu (611/611).
 */
export function wrapperInnerCells(w: BoxWrapper): Vec3[] {
  if (w.cells) return w.cells;
  const out: Vec3[] = [];
  for (let x = w.min.x; x <= w.max.x; x++) {
    for (let y = w.min.y; y <= w.max.y; y++) {
      for (let z = w.min.z; z <= w.max.z; z++) {
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

/** Số ô lớp bọc chiếm mà THẬT SỰ có khối — cho phần hiển thị và soát, không phải cho file. */
export function wrapperFilledCount(grid: VoxelGrid, w: BoxWrapper): number {
  let n = 0;
  for (const p of wrapperInnerCells(w)) {
    if (grid.has(p.x, p.y, p.z)) n++;
  }
  return n;
}

/**
 * Grid dùng để ghi `layers` khi xuất: BỎ các ô nằm trong lớp bọc kiểu KHỐI LỚN.
 *
 * Khối lớn là một cục duy nhất THAY cho cụm voxel nhỏ bên trong, nên trong data thật các ô đó
 * không còn nằm trong `layers` (đo: 536/536 khối lớn có 0% ô inner xuất hiện trong layers). Còn lớp
 * băng thì ngược lại — voxel bên trong vẫn nằm nguyên trong `layers` (75/75), vì băng chỉ là cái vỏ
 * bọc ngoài chứ không thay thế gì.
 */
export function gridForExport(grid: VoxelGrid, wrappers: BoxWrapper[]): VoxelGrid {
  const covered = wrappers.filter((w) => w.kind === 'largeVoxel');
  if (!covered.length) return grid;
  // Theo ĐÚNG hình của khối lớn, không theo hộp bao: khối lớn hình quả cầu thì mấy ô ở góc hộp vẫn
  // là khối thường và phải ở lại `layers` — data thật làm vậy (Level_79 giữ 72 khối như thế).
  const taken = new Set<string>();
  for (const w of covered) {
    for (const p of wrapperInnerCells(w)) taken.add(cellKey(p));
  }
  const out = new VoxelGrid();
  for (const { x, y, z, voxel } of grid.entries()) {
    if (!taken.has(`${x},${y},${z}`)) out.set(x, y, z, { ...voxel });
  }
  return out;
}

/**
 * Số khối từng màu mà TỔNG ĐẠN phải khớp.
 *
 * Khác `blockCountsByColor` ở hai chỗ, và cả hai đều đo được từ data thật của game:
 *
 *  - voxel nằm trong KHỐI LỚN không tính (chúng không còn trong `layers` — xem `gridForExport`);
 *  - mỗi khối lớn tính đúng `hp` viên đạn màu của nó. Đo trên 36 level có khối lớn trong
 *    Data/DataExample2: `đạn − khối(layers)` bằng đúng tổng hp của khối lớn cùng màu ở 35/36 level
 *    (ca còn lại có thêm cơ chế khác mà tool chưa dựng).
 *
 * Lớp BĂNG thì không đổi gì: voxel bên trong vẫn nằm trong layers và vẫn cần đạn như thường — 31/31
 * level chỉ có băng có tổng đạn khớp đúng số khối.
 */
export function shootableCountsByColor(
  grid: VoxelGrid,
  wrappers: BoxWrapper[],
): Map<number, number> {
  const counts = blockCountsByColor(gridForExport(grid, wrappers));
  for (const w of wrappers) {
    if (w.kind !== 'largeVoxel') continue;
    const id = w.color ?? dominantColorId(grid, w);
    counts.set(id, (counts.get(id) ?? 0) + Math.max(0, w.hp));
  }
  return counts;
}

/**
 * Màu chiếm nhiều khối nhất trong hộp — màu mặc định hợp lý cho một khối lớn, vì khối lớn là để
 * THAY cả cụm nhỏ bên trong bằng một cục duy nhất.
 *
 * Bỏ qua tường: tường không phải màu bắn được, để nó thắng phiếu là ra một khối lớn không ai phá
 * nổi. Không có khối màu nào thì trả về ColorType 1.
 */
export function dominantColorId(grid: VoxelGrid, w: BoxWrapper): number {
  const counts = new Map<number, number>();
  for (const p of wrapperInnerCells(w)) {
    const voxel = grid.get(p.x, p.y, p.z);
    if (!voxel || voxel.color === WALL_HEX) continue;
    const id = matchGameColor(voxel.color).color.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = 1;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

interface Face {
  /** Pháp tuyến hướng ra ngoài. */
  n: Vec3;
  axis: 'x' | 'y' | 'z';
  sign: 1 | -1;
}

const FACES: Face[] = [
  { n: { x: 1, y: 0, z: 0 }, axis: 'x', sign: 1 },
  { n: { x: -1, y: 0, z: 0 }, axis: 'x', sign: -1 },
  { n: { x: 0, y: 1, z: 0 }, axis: 'y', sign: 1 },
  { n: { x: 0, y: -1, z: 0 }, axis: 'y', sign: -1 },
  { n: { x: 0, y: 0, z: 1 }, axis: 'z', sign: 1 },
  { n: { x: 0, y: 0, z: -1 }, axis: 'z', sign: -1 },
];

/**
 * Số HP nhô ra khỏi mặt hộp bao nhiêu. Data thật dùng đúng 0.1 ở cả 1603/1603 `hpText` — không nhô
 * thì chữ nằm trùng mặt vỏ.
 */
export const HP_TEXT_OFFSET = 0.1;

/**
 * Mặt nào được dán số HP: CẶP mặt vuông góc trục MỎNG NHẤT — tức hai mặt to nhất của hộp. Hoà (hộp
 * vuông, hoặc hai cạnh bằng nhau) thì lấy bốn mặt bên `x±` `y±`, bỏ trên/dưới.
 *
 * Luật này đọc ra từ data thật: số HP luôn đi theo CẶP đối nhau (572/611 lớp bọc) và luật trên khớp
 * 549/611. Phần lệch còn lại là do người dựng chỉnh tay từng ca (có ca hộp vuông chỉ dán 1 mặt), chứ
 * không theo hình học nào — nên đây là mặc định hợp lý chứ không phải công thức tuyệt đối.
 */
export function hpTextFaces(w: BoxWrapper): Face[] {
  const size = wrapperSize(w);
  const min = Math.min(size.x, size.y, size.z);
  let axes: ('x' | 'y' | 'z')[] = (['x', 'y', 'z'] as const).filter((a) => size[a] === min);
  if (axes.length > 1) axes = ['x', 'y'];
  return FACES.filter((f) => axes.includes(f.axis));
}

/**
 * Sinh `hpTexts`: một số HP trên mỗi mặt của `hpTextFaces`.
 *
 * `position` = tâm mặt, nhô ra ngoài `HP_TEXT_OFFSET`; `direction` = pháp tuyến hướng RA NGOÀI;
 * `up` = trục Z (trục đứng của data), trừ mặt trên/dưới (pháp tuyến ±Z) thì lấy trục X — đúng như
 * data thật: mặt x± / y± dùng up (0,0,1) ở cả 1438/1438 text, mặt z± dùng (1,0,0) ở 154/165.
 */
export function wrapperHpTexts(w: BoxWrapper): HpText[] {
  const { center, extent } = wrapperBounds(w);
  return hpTextFaces(w).map((face) => ({
    position: {
      x: center.x + face.n.x * (extent.x + HP_TEXT_OFFSET),
      y: center.y + face.n.y * (extent.y + HP_TEXT_OFFSET),
      z: center.z + face.n.z * (extent.z + HP_TEXT_OFFSET),
    },
    direction: { ...face.n },
    up: face.axis === 'z' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 },
  }));
}

/**
 * Dựng dữ liệu để ghi ra file (vẫn ở TOẠ ĐỘ EDITOR — phần lật chiều sâu do serializer lo).
 *
 * PHẢI nhận cùng `options` với `buildLayers` của cùng lần xuất: phép dời tâm trừ một lượng khỏi
 * toạ độ khối, không trừ y hệt cho hộp bọc thì trong file hộp lệch khỏi cụm khối nó bọc đúng bằng
 * lượng đó — nhìn trong tool vẫn khớp nên không ai thấy, chỉ vào game mới lòi ra.
 */
export function buildWrapperEntries(
  grid: VoxelGrid,
  wrappers: BoxWrapper[],
  options: BuildLayersOptions = {},
): WrapperEntry[] {
  const { recenter = true, centerOverride = null } = options;
  const off = recenterOffset(grid, recenter, centerOverride);
  return wrappers.map((w) => {
    // Dời hộp về cùng hệ với layer TRƯỚC khi tính bounds; `innerVoxelPositions` cũng dời theo, còn
    // việc soi khối thì vẫn phải soi trên toạ độ editor (grid không dời).
    const shifted: BoxWrapper = {
      ...w,
      min: { x: w.min.x - off.x, y: w.min.y - off.y, z: w.min.z - off.z },
      max: { x: w.max.x - off.x, y: w.max.y - off.y, z: w.max.z - off.z },
    };
    const hpTexts = wrapperHpTexts(w).map((t) => ({
      // `position` là điểm nên phải dời; `direction`/`up` là hướng nên không.
      position: { x: t.position.x - off.x, y: t.position.y - off.y, z: t.position.z - off.z },
      direction: t.direction,
      up: t.up,
    }));
    return {
      kind: w.kind,
      // Chỉ loại có màu mới ghi field này; thiếu thì lấy màu áp đảo trong hộp.
      colorType: wrapperKindInfo(w.kind).hasColor
        ? (w.color ?? dominantColorId(grid, w))
        : undefined,
      bounds: wrapperBounds(shifted),
      hp: w.hp,
      hpTexts,
      innerVoxelPositions: wrapperInnerCells(w).map((p) => ({
        x: p.x - off.x,
        y: p.y - off.y,
        z: p.z - off.z,
      })),
    };
  });
}

/** Hai hộp bao có chạm nhau không — phép thử rẻ, chạy trước khi đụng tới tập ô. */
const boxesTouch = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }): boolean =>
  a.min.x <= b.max.x && b.min.x <= a.max.x &&
  a.min.y <= b.max.y && b.min.y <= a.max.y &&
  a.min.z <= b.max.z && b.min.z <= a.max.z;

const inBox = (p: Vec3, box: { min: Vec3; max: Vec3 }): boolean =>
  p.x >= box.min.x && p.x <= box.max.x &&
  p.y >= box.min.y && p.y <= box.max.y &&
  p.z >= box.min.z && p.z <= box.max.z;

/**
 * Hộp `box` có đè lên lớp bọc nào đang có không — chỗ đặt dùng để chặn trước khi tạo.
 *
 * Lớp bọc có hình riêng thì phải so tới từng Ô: hộp bao của một khối lớn hình cầu chừa ra mấy góc
 * trống, đặt lớp bọc khác vào đúng mấy góc đó là hợp lệ (data thật để cả khối thường ở đấy) — chặn
 * theo hộp bao là chặn oan.
 */
export function overlapsAnyWrapper(
  wrappers: BoxWrapper[],
  box: { min: Vec3; max: Vec3 },
  ignoreId?: number,
): boolean {
  return wrappers.some((w) => {
    if (w.id === ignoreId || !boxesTouch(w, box)) return false;
    if (!w.cells) return true;
    return w.cells.some((p) => inBox(p, box));
  });
}

const overlaps = (a: BoxWrapper, b: BoxWrapper): boolean => {
  if (!boxesTouch(a, b)) return false;
  if (!a.cells && !b.cells) return true;
  // Quét tập nhỏ hơn, tra trên tập lớn hơn.
  const [small, big] = (a.cells?.length ?? Infinity) <= (b.cells?.length ?? Infinity) ? [a, b] : [b, a];
  const set = wrapperCellSet(big);
  return wrapperInnerCells(small).some((p) => set.has(cellKey(p)));
};

/**
 * Soát các lớp bọc trước khi xuất. Trả về danh sách vấn đề bằng tiếng người, thứ tự nặng trước.
 *
 * Mấy lỗi này đều không lộ ra khi nhìn scene, mà vào game thì thành màn không chơi được hoặc lớp
 * bọc treo giữa không khí — nên phải soát ở tool.
 */
export function validateWrappers(grid: VoxelGrid, wrappers: BoxWrapper[]): string[] {
  const problems: string[] = [];
  const label = (w: BoxWrapper) => {
    const s = wrapperSize(w);
    const k = wrapperKindInfo(w.kind);
    const shape = w.cells ? `, hình riêng ${w.cells.length} ô` : '';
    return `${k.label} #${w.id} (${s.x}×${s.y}×${s.z}${shape} tại ${w.min.x},${w.min.y},${w.min.z})`;
  };

  // Nhắc một lần cho cả level, không phải mỗi hộp một dòng.
  for (const k of WRAPPER_KINDS) {
    if (k.v1 || !wrappers.some((w) => w.kind === k.kind)) continue;
    problems.push(
      `Có lớp bọc loại ${k.label} — file xuất ra đúng chuẩn, nhưng gameplay V1 chưa đọc ` +
        `${k.field} (LevelData.cs xếp nó vào "extensibility placeholders"), nên trong game chưa ` +
        `thấy tác dụng.`,
    );
  }

  for (const w of wrappers) {
    const inner = wrapperInnerCells(w);
    // Đếm trên VÙNG LỚP BỌC CHIẾM, không phải thể tích hộp bao: lớp bọc có hình riêng thì mấy ô
    // trong hộp mà nó không chiếm chẳng liên quan gì tới nó.
    const volume = inner.length;
    const filled = wrapperFilledCount(grid, w);

    // Chỉ BĂNG mới cần có khối bên trong: nó là cái vỏ bọc quanh khối có sẵn. KHỐI LỚN thì tự nó
    // là một cục, không cần bọc gì — data thật có cả level chỉ toàn khối lớn mà `layers` trống trơn
    // (Level_178: 0 khối, 64 khối lớn).
    if (!filled && w.kind === 'ice') {
      problems.push(`${label(w)} không bọc khối nào — vào game là một lớp vỏ rỗng treo giữa không khí.`);
      continue;
    }
    if (w.hp <= 0) {
      problems.push(`${label(w)} có hp = ${w.hp} — phải ≥ 1, không thì vỏ vỡ ngay khi vào màn.`);
    }
    let walls = 0;
    for (const p of inner) {
      if (grid.get(p.x, p.y, p.z)?.color === WALL_HEX) walls++;
    }
    if (filled > 0 && walls === filled) {
      problems.push(`${label(w)} chỉ bọc tường — tường không bắn được nên phá vỏ xong chẳng có gì để phá.`);
    }
    if (filled < volume && w.kind === 'ice') {
      problems.push(
        `${label(w)} có ${volume - filled}/${volume} ô trống trong vùng bọc — vào game mấy ô đó là ` +
          `vỏ băng rỗng, không có khối nào bên trong.`,
      );
    }
  }

  // Khối lớn nuốt luôn các voxel bên trong khỏi `layers` (xem `gridForExport`), nên bảng cân đối
  // đạn không còn đếm chúng. Nói ra vì đó là thay đổi lớn với phần súng.
  const swallowed = wrappers
    .filter((w) => w.kind === 'largeVoxel')
    .reduce((n, w) => n + wrapperFilledCount(grid, w), 0);
  if (swallowed) {
    const hp = wrappers
      .filter((w) => w.kind === 'largeVoxel')
      .reduce((n, w) => n + Math.max(0, w.hp), 0);
    problems.push(
      `${swallowed} khối nằm trong lớp bọc Khối lớn sẽ KHÔNG được ghi vào layers (đúng như data ` +
        `của game: khối lớn thay cả cụm nhỏ). Bảng đạn đã tính lại giúp: chỗ ${swallowed} khối đó ` +
        `giờ cần ${hp} viên theo màu của từng khối lớn (bằng hp), không phải ${swallowed} viên.`,
    );
  }

  for (let i = 0; i < wrappers.length; i++) {
    for (let j = i + 1; j < wrappers.length; j++) {
      if (overlaps(wrappers[i], wrappers[j])) {
        problems.push(
          `${label(wrappers[i])} và ${label(wrappers[j])} CHỒNG NHAU — một voxel không thể thuộc ` +
            `hai lớp bọc, data này game đọc lên là sai.`,
        );
      }
    }
  }

  return problems;
}
