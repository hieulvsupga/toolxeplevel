import { VoxelGrid } from './VoxelGrid';
import { WALL_HEX } from './gameColors';
import { recenterOffset, type BuildLayersOptions } from './layers';
import type { Vec3 } from './types';

/**
 * LỚP BỌC dạng hộp — cơ chế bọc một khối hộp voxel lại, phải phá vỏ mới bắn được phần trong.
 *
 * Data của game có cả một họ cơ chế cùng một khuôn (`bounds` + `hp` + `hpTexts` +
 * `innerVoxelPositions`): IceWrapper, Shield, GiftWrapper, ColorBox, Playpen… `ShieldData` và
 * `IceWrapperData` giống nhau từng field nên dựng chung một đường, chỉ khác chỗ ghi vào mảng nào
 * trong file. Thêm loại nữa (Gift, ColorBox…) cũng chỉ là thêm một dòng vào `WRAPPER_KINDS`.
 *
 * LƯU Ý về shield: `LevelData.cs` ghi rõ chỉ `iceWrapperData` là "V1-relevant", còn `shieldData`
 * nằm dưới "Extensibility placeholders — not acted on by V1 gameplay code". Tool xuất đúng data,
 * nhưng game V1 chưa đọc — `validateWrappers` nhắc lại điều này để không ai tưởng đã thử được.
 */
export type WrapperKind = 'ice' | 'shield';

/** Bảng loại lớp bọc: nhãn cho UI + tên mảng tương ứng trong file .asset. */
export const WRAPPER_KINDS: {
  kind: WrapperKind;
  icon: string;
  label: string;
  field: string;
  /** Gameplay V1 có chạy loại này không. */
  v1: boolean;
}[] = [
  { kind: 'ice', icon: '🧊', label: 'Băng', field: 'iceWrapperData', v1: true },
  { kind: 'shield', icon: '🛡', label: 'Shield', field: 'shieldData', v1: false },
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

/** Một phần tử của `iceWrapperData` (và cả họ cơ chế cùng khuôn). */
export interface WrapperEntry {
  kind: WrapperKind;
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

/** Ô nằm trong hộp có khối — `innerVoxelPositions`. Duyệt theo thứ tự x → y → z cho ổn định. */
export function wrapperInnerCells(grid: VoxelGrid, w: BoxWrapper): Vec3[] {
  const out: Vec3[] = [];
  for (let x = w.min.x; x <= w.max.x; x++) {
    for (let y = w.min.y; y <= w.max.y; y++) {
      for (let z = w.min.z; z <= w.max.z; z++) {
        if (grid.has(x, y, z)) out.push({ x, y, z });
      }
    }
  }
  return out;
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
 * Mặt nào của hộp đang HỞ: quá nửa số ô trên mặt đó không bị khối nào (ngoài hộp) chắn ngay bên
 * ngoài.
 *
 * Dùng để chỉ dán số HP lên mặt người chơi thật sự nhìn thấy. Lấy mốc "quá nửa" chứ không phải "có
 * một ô hở": hộp nằm sát tường mà lòi ra một ô thì mặt đó coi như bị che, dán số vào là số nằm
 * trong lòng khối.
 */
export function exposedFaces(grid: VoxelGrid, w: BoxWrapper): Face[] {
  const out: Face[] = [];
  for (const face of FACES) {
    let free = 0;
    let total = 0;
    const at = face.sign === 1 ? w.max[face.axis] : w.min[face.axis];
    const outside = at + face.sign;
    // Quét lớp ô sát mặt, rồi soi ô liền kề PHÍA NGOÀI hộp.
    const range = (axis: 'x' | 'y' | 'z'): [number, number] =>
      axis === face.axis ? [outside, outside] : [w.min[axis], w.max[axis]];
    const [x0, x1] = range('x');
    const [y0, y1] = range('y');
    const [z0, z1] = range('z');
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          total++;
          if (!grid.has(x, y, z)) free++;
        }
      }
    }
    if (total && free * 2 > total) out.push(face);
  }
  return out;
}

/**
 * Sinh `hpTexts` cho một hộp: một số HP trên mỗi mặt đang hở.
 *
 * `position` là TÂM MẶT (tâm hộp cộng extent theo pháp tuyến), `direction` là pháp tuyến, `up` là
 * chiều đứng của chữ — lấy trục Z (trục đứng của data) trừ khi chính mặt đó nhìn theo Z, lúc đó
 * chữ nằm ngang nên lấy Y làm chiều đứng.
 */
export function wrapperHpTexts(grid: VoxelGrid, w: BoxWrapper): HpText[] {
  const { center, extent } = wrapperBounds(w);
  return exposedFaces(grid, w).map((face) => ({
    position: {
      x: center.x + face.n.x * extent.x,
      y: center.y + face.n.y * extent.y,
      z: center.z + face.n.z * extent.z,
    },
    direction: { ...face.n },
    up: face.axis === 'z' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 },
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
    const hpTexts = wrapperHpTexts(grid, w).map((t) => ({
      // `position` là điểm nên phải dời; `direction`/`up` là hướng nên không.
      position: { x: t.position.x - off.x, y: t.position.y - off.y, z: t.position.z - off.z },
      direction: t.direction,
      up: t.up,
    }));
    return {
      kind: w.kind,
      bounds: wrapperBounds(shifted),
      hp: w.hp,
      hpTexts,
      innerVoxelPositions: wrapperInnerCells(grid, w).map((p) => ({
        x: p.x - off.x,
        y: p.y - off.y,
        z: p.z - off.z,
      })),
    };
  });
}

const overlaps = (a: BoxWrapper, b: BoxWrapper): boolean =>
  a.min.x <= b.max.x &&
  b.min.x <= a.max.x &&
  a.min.y <= b.max.y &&
  b.min.y <= a.max.y &&
  a.min.z <= b.max.z &&
  b.min.z <= a.max.z;

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
    return `${k.label} #${w.id} (${s.x}×${s.y}×${s.z} tại ${w.min.x},${w.min.y},${w.min.z})`;
  };

  // Nhắc một lần cho cả level, không phải mỗi hộp một dòng.
  if (wrappers.some((w) => !wrapperKindInfo(w.kind).v1)) {
    problems.push(
      'Có lớp bọc loại Shield — file xuất ra đúng chuẩn, nhưng gameplay V1 chưa đọc shieldData ' +
        '(LevelData.cs xếp nó vào "extensibility placeholders"), nên trong game chưa thấy tác dụng.',
    );
  }

  for (const w of wrappers) {
    const size = wrapperSize(w);
    const volume = size.x * size.y * size.z;
    const inner = wrapperInnerCells(grid, w);

    if (!inner.length) {
      problems.push(`${label(w)} không bọc khối nào — vào game là một lớp vỏ rỗng treo giữa không khí.`);
      continue;
    }
    if (w.hp <= 0) {
      problems.push(`${label(w)} có hp = ${w.hp} — phải ≥ 1, không thì vỏ vỡ ngay khi vào màn.`);
    }
    if (inner.every((p) => grid.get(p.x, p.y, p.z)?.color === WALL_HEX)) {
      problems.push(`${label(w)} chỉ bọc tường — tường không bắn được nên phá vỏ xong chẳng có gì để phá.`);
    }
    if (inner.length < volume) {
      problems.push(
        `${label(w)} có ${volume - inner.length}/${volume} ô trống bên trong — vỏ là một khối hộp ` +
          `nên trong game sẽ thấy hở ở mấy ô đó.`,
      );
    }
    if (!exposedFaces(grid, w).length) {
      problems.push(`${label(w)} bị khối khác che kín cả 6 mặt — không dán được số HP lên mặt nào.`);
    }
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
