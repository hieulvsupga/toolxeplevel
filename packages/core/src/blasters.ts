import { VoxelGrid } from './VoxelGrid';
import { WALL_COLOR_ID, gameColorById, matchGameColor } from './gameColors';
import type { LevelLayer } from './layers';

/** `BlasterType` bên Unity. V1 của tool chỉ dựng Normal; các loại còn lại để chọn tay. */
export const BLASTER_TYPES: { id: number; name: string; label: string }[] = [
  { id: 0, name: 'Normal', label: 'Súng thường' },
  { id: 1, name: 'Key', label: 'Chìa khoá' },
  { id: 2, name: 'Lock', label: 'Ổ khoá' },
  { id: 3, name: 'Scissors', label: 'Kéo' },
  { id: 4, name: 'Generator', label: 'Máy đẻ súng' },
  { id: 5, name: 'Hammer', label: 'Búa' },
  { id: 6, name: 'Sword', label: 'Kiếm' },
  { id: 7, name: 'Propeller', label: 'Chong chóng' },
  { id: 8, name: 'StopSign', label: 'Biển stop' },
];

export const BLASTER_TYPE_NORMAL = 0;

/** Một `BlasterData` bên Unity — 1:1 với các field trong `Data/Shooter/BlasterData.cs`. */
export interface BlasterEntry {
  id: number;
  sourceId: number;
  /** Giá trị enum `BlasterType`. */
  type: number;
  /** Giá trị enum `ColorType` — màu đạn. */
  color: number;
  /** Màu thứ hai (súng Double). 0 = None = súng một màu. */
  secondaryColor: number;
  bulletCount: number;
  isHidden: boolean;
  iceHp: number;
  isPilot: boolean;
  isChained: boolean;
  connectedBlasterIds: number[];
  chainedBlasterIds: number[];
  innerBlasterIds: number[];
}

/**
 * Phần shooter của một level: pool súng phẳng + các hàng chờ dưới đáy.
 *
 * Giữ đúng dạng của data (id chứ không phải object lồng nhau) để nhập/xuất không phải dịch qua
 * lại: `dockColumns[i][j]` là `BlasterEntry.id`.
 */
export interface ShooterSetup {
  blasters: BlasterEntry[];
  dockColumns: number[][];
}

export const EMPTY_SHOOTERS: ShooterSetup = { blasters: [], dockColumns: [] };

/** Mọi level mẫu đều đánh id từ 1000 — giữ nếp đó để id đọc lên là biết ngay của tool nào. */
export const FIRST_BLASTER_ID = 1000;

export function nextBlasterId(blasters: BlasterEntry[]): number {
  let max = FIRST_BLASTER_ID - 1;
  for (const b of blasters) max = Math.max(max, b.id);
  return max + 1;
}

export function makeBlaster(partial: Partial<BlasterEntry> & { id: number }): BlasterEntry {
  return {
    sourceId: 0,
    type: BLASTER_TYPE_NORMAL,
    color: 1,
    secondaryColor: 0,
    bulletCount: 30,
    isHidden: false,
    iceHp: 0,
    isPilot: false,
    isChained: false,
    connectedBlasterIds: [],
    chainedBlasterIds: [],
    innerBlasterIds: [],
    ...partial,
  };
}

// ---------- List<int> trong file .asset ----------

/**
 * Unity ghi `List<int>` trong file text KHÔNG phải dạng chuỗi YAML mà là blob hex: mỗi số 4 byte
 * little-endian, nối liền nhau (1000 -> `e8030000`). Danh sách rỗng ghi thành xâu trống.
 *
 * Không thay được bằng dạng `- 1000` cho dễ đọc: Unity đọc field này theo đúng dạng nó ghi ra.
 */
export function encodeIntList(values: number[]): string {
  let out = '';
  for (const value of values) {
    const v = value >>> 0;
    out +=
      (v & 255).toString(16).padStart(2, '0') +
      ((v >>> 8) & 255).toString(16).padStart(2, '0') +
      ((v >>> 16) & 255).toString(16).padStart(2, '0') +
      ((v >>> 24) & 255).toString(16).padStart(2, '0');
  }
  return out;
}

export function decodeIntList(raw: string): number[] {
  const hex = raw.trim();
  if (!hex) return [];
  const out: number[] = [];
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    const b0 = parseInt(hex.slice(i, i + 2), 16);
    const b1 = parseInt(hex.slice(i + 2, i + 4), 16);
    const b2 = parseInt(hex.slice(i + 4, i + 6), 16);
    const b3 = parseInt(hex.slice(i + 6, i + 8), 16);
    if ([b0, b1, b2, b3].some(Number.isNaN)) continue;
    out.push(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24));
  }
  return out;
}

// ---------- Cân đối đạn / khối ----------

/** Số khối theo `ColorType` (kể cả ô tường) — đếm thẳng từ grid, không cần tính depth. */
export function blockCountsByColor(grid: VoxelGrid): Map<number, number> {
  const counts = new Map<number, number>();
  for (const { voxel } of grid.entries()) {
    const id = matchGameColor(voxel.color).color.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Như trên nhưng đếm từ `LayerData` đã dựng (dùng khi nhập .asset). */
export function blockCountsByColorFromLayers(layers: LevelLayer[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const layer of layers) {
    counts.set(layer.colorType, (counts.get(layer.colorType) ?? 0) + layer.voxelPositions.length);
  }
  return counts;
}

/**
 * Số đạn theo `ColorType`.
 *
 * Súng hai màu (`secondaryColor` khác None) tính đủ `bulletCount` cho CẢ HAI màu — đo trên
 * DoubleBlasterBox.asset thì chỉ cách tính này mới ra khớp số khối (494 khối = 247 đạn màu chính +
 * 247 đạn màu phụ).
 */
export function bulletCountsByColor(blasters: BlasterEntry[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const b of blasters) {
    counts.set(b.color, (counts.get(b.color) ?? 0) + b.bulletCount);
    if (b.secondaryColor !== WALL_COLOR_ID) {
      counts.set(b.secondaryColor, (counts.get(b.secondaryColor) ?? 0) + b.bulletCount);
    }
  }
  return counts;
}

export interface ColorBalanceRow {
  colorType: number;
  blocks: number;
  bullets: number;
  /** bullets - blocks. 0 = vừa đủ, âm = thiếu đạn (không phá xong màn), dương = thừa. */
  diff: number;
}

/**
 * So số đạn với số khối theo từng màu — điều kiện thắng của màn là bắn hết khối, nên đây là phép
 * kiểm quan trọng nhất của bảng blaster.
 *
 * Ô tường (`ColorType.None`) bị loại khỏi bảng: nó là vật cản vĩnh viễn, không bao giờ là mục tiêu
 * nên không có súng nào bắn nó.
 */
export function colorBalance(
  blockCounts: Map<number, number>,
  blasters: BlasterEntry[],
): ColorBalanceRow[] {
  const bullets = bulletCountsByColor(blasters);
  const colors = new Set<number>([...blockCounts.keys(), ...bullets.keys()]);
  colors.delete(WALL_COLOR_ID);
  return [...colors]
    .sort((a, b) => a - b)
    .map((colorType) => {
      const blocks = blockCounts.get(colorType) ?? 0;
      const bul = bullets.get(colorType) ?? 0;
      return { colorType, blocks, bullets: bul, diff: bul - blocks };
    });
}

/**
 * Các lỗi khiến level không chạy được (hoặc không thắng được) bên Unity. Trả về câu tiếng Việt để
 * hiện thẳng cho người dựng level.
 */
export function validateShooters(
  setup: ShooterSetup,
  blockCounts: Map<number, number>,
): string[] {
  const problems: string[] = [];
  const { blasters, dockColumns } = setup;

  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const b of blasters) {
    if (seen.has(b.id)) duplicates.add(b.id);
    seen.add(b.id);
  }
  if (duplicates.size) {
    problems.push(`id trùng nhau: ${[...duplicates].join(', ')} — mỗi súng phải có id riêng.`);
  }

  const placed = new Map<number, number>();
  for (const column of dockColumns) {
    for (const id of column) placed.set(id, (placed.get(id) ?? 0) + 1);
  }

  const unknown = [...placed.keys()].filter((id) => !seen.has(id));
  if (unknown.length) {
    problems.push(`Hàng chờ nhắc tới id không có súng nào: ${unknown.join(', ')}.`);
  }

  const orphans = blasters.filter((b) => !placed.has(b.id)).map((b) => b.id);
  if (orphans.length) {
    problems.push(`Súng chưa được xếp vào hàng nào: ${orphans.join(', ')}.`);
  }

  const twice = [...placed.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (twice.length) {
    problems.push(`Súng bị xếp vào nhiều chỗ: ${twice.join(', ')}.`);
  }

  const noColor = blasters.filter((b) => b.color === WALL_COLOR_ID).map((b) => b.id);
  if (noColor.length) {
    problems.push(`Súng chưa chọn màu (None): ${noColor.join(', ')}.`);
  }

  const noBullet = blasters.filter((b) => b.bulletCount <= 0).map((b) => b.id);
  if (noBullet.length) {
    problems.push(`Súng có bulletCount ≤ 0: ${noBullet.join(', ')}.`);
  }

  for (const row of colorBalance(blockCounts, blasters)) {
    if (row.diff === 0) continue;
    const name = gameColorById(row.colorType)?.name ?? `ColorType ${row.colorType}`;
    problems.push(
      row.diff < 0
        ? `${name}: thiếu ${-row.diff} đạn (${row.bullets} đạn / ${row.blocks} khối) — không phá hết khối được.`
        : `${name}: thừa ${row.diff} đạn (${row.bullets} đạn / ${row.blocks} khối).`,
    );
  }

  return problems;
}

// ---------- Tạo nhanh theo màu khối ----------

export interface AutoShooterOptions {
  /** Số hàng chờ dưới đáy. */
  rowCount: number;
  /** Số đạn mong muốn cho mỗi súng — chỉ là mục tiêu, số thực tế chia cho khớp số khối. */
  bulletsPerBlaster: number;
  /** Giữ nguyên các id đang dùng thì truyền vào để id mới không đụng. */
  startId?: number;
}

/**
 * Sinh sẵn một bộ súng khớp đúng số khối từng màu, rải đều ra các hàng.
 *
 * Chia theo từng màu rồi phát vòng tròn (round-robin) vào các hàng, nên mỗi hàng là một hỗn hợp
 * màu thay vì một hàng toàn một màu — người chơi mới có việc phải chọn.
 */
export function autoShooters(
  blockCounts: Map<number, number>,
  options: AutoShooterOptions,
): ShooterSetup {
  const rowCount = Math.max(1, Math.floor(options.rowCount));
  const target = Math.max(1, Math.floor(options.bulletsPerBlaster));
  let id = options.startId ?? FIRST_BLASTER_ID;

  const blasters: BlasterEntry[] = [];
  const colors = [...blockCounts.keys()].filter((c) => c !== WALL_COLOR_ID).sort((a, b) => a - b);

  for (const color of colors) {
    const blocks = blockCounts.get(color) ?? 0;
    if (blocks <= 0) continue;
    // Số súng lấy theo mục tiêu đạn/súng, nhưng phần chia thì bám số khối: base + 1 cho `rest`
    // súng đầu, để tổng luôn đúng bằng số khối chứ không phải xấp xỉ.
    const count = Math.max(1, Math.round(blocks / target));
    const base = Math.floor(blocks / count);
    const rest = blocks - base * count;
    for (let i = 0; i < count; i++) {
      blasters.push(
        makeBlaster({ id: id++, color, bulletCount: base + (i < rest ? 1 : 0) }),
      );
    }
  }

  const dockColumns: number[][] = Array.from({ length: rowCount }, () => []);
  blasters.forEach((b, i) => dockColumns[i % rowCount].push(b.id));

  return { blasters, dockColumns };
}
