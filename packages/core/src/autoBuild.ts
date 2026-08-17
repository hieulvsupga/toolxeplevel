import {
  BLASTER_TYPE_KEY,
  BLASTER_TYPE_LOCK,
  FIRST_BLASTER_ID,
  autoShooters,
  toggleConnection,
  type BlasterEntry,
  type ShooterSetup,
} from './blasters';
import { WALL_COLOR_ID } from './gameColors';
import { checkWinnable, rateDifficulty } from './solve';
import type { VoxelGrid } from './VoxelGrid';

/**
 * Cơ chế mà bộ tạo nhanh biết dựng. Đúng bằng danh sách mechanic bấm tay được trong
 * bảng blaster của editor — thêm ở đây mà editor không dựng nổi thì level sinh ra
 * không sửa lại được bằng tay.
 */
export type AutoMechanicKey = 'connected' | 'ice' | 'lock' | 'double' | 'hidden';

export const AUTO_MECHANICS: { key: AutoMechanicKey; label: string; unit: string; hint: string }[] =
  [
    {
      key: 'connected',
      label: '🔗 Connected',
      unit: 'cặp',
      hint: 'Nối 2 khẩu cùng bậc ở hai hàng khác nhau: cả cặp lên khoang chờ cùng một lượt (phải còn đủ ô cho cả cặp), và chỉ biến mất khi CẢ HAI bắn xong — khẩu hết đạn trước vẫn giữ ô.',
    },
    {
      key: 'ice',
      label: '🧊 Ice',
      unit: 'khẩu',
      hint: 'Bọc băng, không bấm lên được cho tới khi băng tan. Luôn chừa đầu một hàng không băng, nếu không thì màn bị bí ngay từ nước đầu.',
    },
    {
      key: 'lock',
      label: '🔒 Lock + 🔑 Key',
      unit: 'cặp',
      hint: 'Mỗi cặp = 1 ổ khoá + 1 chìa ở hàng khác. Ổ luôn nằm từ bậc 2 trở xuống để còn rút được khẩu đầu hàng.',
    },
    {
      key: 'double',
      label: '🎨 Double',
      unit: 'khẩu',
      hint: 'Gộp 2 khẩu khác màu thành 1 khẩu hai màu (mỗi màu một túi đạn) — số đạn vẫn khớp đúng số khối từng màu.',
    },
    {
      key: 'hidden',
      label: '❓ Hidden',
      unit: 'khẩu',
      hint: 'Giấu màu, chỉ lộ khi khẩu ngay trước được nhấc lên. Không giấu khẩu đang đứng đầu hàng vì nó không còn ai phía trước.',
    },
  ];

/** Thang điểm khó của tool — cùng thang mà `rateDifficulty` chấm một màn đã dựng. */
export const MAX_DIFFICULTY_SCORE = 10;

/**
 * Cơ chế mở dần theo điểm khó: xuất hiện từ mốc `from`, số lượng nội suy tuyến tính từ
 * `atFrom` (ở mốc đó) tới `atMax` (ở điểm 10).
 *
 * Thứ tự mốc đi theo mức độ làm rối người chơi: băng và giấu màu vào sớm vì chúng chỉ làm
 * khó tính toán; khoá và súng hai màu vào muộn vì chúng khoá cứng thứ tự bấm.
 */
const MECHANIC_SCALE: Record<AutoMechanicKey, { from: number; atFrom: number; atMax: number }> = {
  ice: { from: 2, atFrom: 1, atMax: 5 },
  hidden: { from: 3, atFrom: 1, atMax: 5 },
  connected: { from: 4, atFrom: 1, atMax: 3 },
  lock: { from: 6, atFrom: 1, atMax: 3 },
  double: { from: 7, atFrom: 1, atMax: 3 },
};

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 1;
  return Math.min(MAX_DIFFICULTY_SCORE, Math.max(1, score));
}

/**
 * Các cơ chế bật sẵn ở một mức điểm — dùng cho popup tạo nhanh, để chọn điểm là ra ngay
 * một bộ hợp lý mà vẫn sửa lại được từng cái.
 */
export function mechanicsForScore(score: number): AutoMechanicKey[] {
  const s = clampScore(score);
  return AUTO_MECHANICS.filter((m) => s >= MECHANIC_SCALE[m.key].from).map((m) => m.key);
}

/**
 * Khoảng số lượng random của một cơ chế ở mức điểm đó. Min luôn ≥ 1: bật một cơ chế rồi
 * nhận về 0 khẩu thì không ai hiểu tại sao.
 */
export function mechanicCountRange(key: AutoMechanicKey, score: number): [number, number] {
  const s = clampScore(score);
  const { from, atFrom, atMax } = MECHANIC_SCALE[key];
  const span = MAX_DIFFICULTY_SCORE - from;
  const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (s - from) / span));
  const center = atFrom + (atMax - atFrom) * t;
  const min = Math.max(1, Math.round(center - 0.5));
  // Chặn trên ở `atMax` để mốc điểm 10 ra đúng con số đã khai, không bị phần nới ±0.5 đẩy lố.
  return [min, Math.max(min, Math.min(atMax, Math.round(center + 0.5)))];
}

/**
 * Cách rải súng vào các hàng chờ — đòn bẩy độ khó mạnh nhất mà bộ sinh có, vì khoang chờ chỉ
 * có 5 ô và thua game là khi 5 khẩu trên khoang không khớp khối hở nào.
 *
 *  - `mixed`      rải vòng tròn theo thứ tự tạo: mỗi hàng hỗn hợp màu, đầu các hàng lúc nào cũng
 *                 nhiều màu để chọn -> DỄ nhất.
 *  - `grouped`    xếp theo màu rồi cắt khúc: mỗi hàng dồn một màu, muốn tới màu dưới phải tiêu hết
 *                 cụm trên. Đầu các hàng vẫn khác màu nhau.
 *  - `sameHeads`  xếp theo màu rồi rải vòng tròn: ĐẦU mọi hàng cùng một màu, nên khoang chờ dễ bị
 *                 nhồi toàn một màu và tắc ngay khi màu đó hết khối hở -> KHÓ nhất, và cũng là
 *                 kiểu dễ thành màn không giải được (vòng dò sẽ tự loại nếu bí).
 */
export type DockLayout = 'mixed' | 'grouped' | 'sameHeads';

export interface AutoBuildOptions {
  rowCount: number;
  bulletsPerBlaster: number;
  /**
   * Điểm khó mong muốn trên thang 1..10 (thang của `rateDifficulty`, KHÔNG phải enum
   * `LevelDifficulty` của Unity) — quyết định khoảng random số lượng khi không nhập số cụ thể.
   */
  difficultyScore: number;
  /**
   * Cơ chế được bật. Có mặt key = bật; `null` = để tool tự random theo độ khó; số = đúng
   * số đó (vẫn bị chặn lại nếu bàn không đủ khẩu hợp lệ).
   */
  mechanics: Partial<Record<AutoMechanicKey, number | null>>;
  /**
   * Cách rải súng vào các hàng chờ:
   *  - `mixed` (mặc định): rải vòng tròn nên mỗi hàng là hỗn hợp màu — đầu các hàng lúc nào cũng
   *    có nhiều màu để chọn, tức DỄ.
   *  - `grouped`: xếp theo màu nên mỗi hàng dồn cùng một màu — muốn tới màu bên dưới thì phải
   *    tiêu hết cả cụm màu trên, tức KHÓ. Đây là thứ đẩy điểm khó thật (yếu tố `mixing` và áp lực
   *    khoang chờ), khác với việc chỉ nhồi thêm cơ chế.
   */
  layout?: DockLayout;
  startId?: number;
  /** Cho test truyền RNG cố định. Mặc định `Math.random`. */
  random?: () => number;
}

export interface AutoBuildResult {
  setup: ShooterSetup;
  /** Số thực tế đã dựng được của từng cơ chế. */
  applied: Partial<Record<AutoMechanicKey, number>>;
  /** Chỗ dựng thiếu so với yêu cầu, viết sẵn thành câu để hiện cho người dựng level. */
  notes: string[];
}

function randInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

/** Trộn mảng (Fisher-Yates) trên bản copy. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Số lượng yêu cầu của một cơ chế: số đã nhập, hoặc random theo độ khó. */
function wantedCount(
  key: AutoMechanicKey,
  options: AutoBuildOptions,
  rng: () => number,
): number {
  const asked = options.mechanics[key];
  if (typeof asked === 'number') return Math.max(0, Math.floor(asked));
  const [min, max] = mechanicCountRange(key, options.difficultyScore);
  return randInt(rng, min, max);
}

/** Vị trí [hàng, bậc] của mọi súng đang xếp trong các hàng chờ. */
function positions(dockColumns: number[][]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  dockColumns.forEach((column, row) => {
    column.forEach((id, index) => out.set(id, [row, index]));
  });
  return out;
}

/**
 * Gộp từng cặp khẩu khác màu thành một khẩu hai màu.
 *
 * Khẩu hai màu tính ĐỦ `bulletCount` cho cả hai màu, nên không thể chỉ gắn thêm màu phụ
 * vào một khẩu có sẵn — làm vậy là tự nhiên thừa ra một túi đạn và lệch bảng cân đối. Cách
 * đúng là lấy hai khẩu khác màu, cho khẩu gộp giữ số đạn nhỏ hơn, rồi đẩy phần dư của khẩu
 * to hơn sang một khẩu khác cùng màu. Không có chỗ đẩy phần dư thì bỏ qua cặp đó.
 */
function mergeDoubles(
  blasters: BlasterEntry[],
  want: number,
  rng: () => number,
): { blasters: BlasterEntry[]; made: number } {
  let list = blasters.map((b) => ({ ...b }));
  let made = 0;

  for (let n = 0; n < want; n++) {
    const plain = list.filter((b) => b.secondaryColor === WALL_COLOR_ID);
    const byColor = new Map<number, BlasterEntry[]>();
    for (const b of plain) {
      const same = byColor.get(b.color) ?? [];
      same.push(b);
      byColor.set(b.color, same);
    }
    // Chỉ lấy màu còn ≥ 2 khẩu: rút một khẩu ra làm màu phụ mà màu đó chỉ có 1 khẩu thì
    // phần dư không còn khẩu cùng màu nào nhận, cặp đó chắc chắn bỏ.
    const colors = shuffled(
      [...byColor.keys()].filter((c) => (byColor.get(c) ?? []).length >= 2),
      rng,
    );
    if (colors.length < 2) break;

    const [colorA, colorB] = colors;
    const a = (byColor.get(colorA) ?? [])[0];
    const b = (byColor.get(colorB) ?? [])[0];
    const keep = Math.min(a.bulletCount, b.bulletCount);
    const restA = a.bulletCount - keep;
    const restB = b.bulletCount - keep;

    const spareA = (byColor.get(colorA) ?? []).find((x) => x.id !== a.id);
    const spareB = (byColor.get(colorB) ?? []).find((x) => x.id !== b.id);
    if ((restA && !spareA) || (restB && !spareB)) break;

    list = list
      .filter((x) => x.id !== b.id)
      .map((x) => {
        if (x.id === a.id) {
          return { ...x, secondaryColor: colorB, bulletCount: keep };
        }
        if (spareA && x.id === spareA.id) return { ...x, bulletCount: x.bulletCount + restA };
        if (spareB && x.id === spareB.id) return { ...x, bulletCount: x.bulletCount + restB };
        return x;
      });
    made++;
  }

  return { blasters: list, made };
}

/**
 * Dựng cả bộ súng theo số khối từng màu, kèm các cơ chế được chọn.
 *
 * Thứ tự bắt buộc: gộp súng hai màu TRƯỚC (nó thêm/bớt khẩu), rải hàng lại, rồi mới tới
 * các cơ chế phụ thuộc vị trí (băng / khoá / giấu màu / nối) — mấy cơ chế đó phải biết khẩu
 * nào đang đứng đầu hàng mới tránh được các thế bí mà `validateShooters` sẽ chặn.
 */
export function autoBuildShooterSetup(
  blockCounts: Map<number, number>,
  options: AutoBuildOptions,
): AutoBuildResult {
  const rng = options.random ?? Math.random;
  const rowCount = Math.max(1, Math.floor(options.rowCount));
  const notes: string[] = [];
  const applied: Partial<Record<AutoMechanicKey, number>> = {};

  const base = autoShooters(blockCounts, {
    rowCount,
    bulletsPerBlaster: options.bulletsPerBlaster,
    startId: options.startId ?? FIRST_BLASTER_ID,
  });
  let blasters = base.blasters;

  const short = (key: AutoMechanicKey, want: number, made: number) => {
    applied[key] = made;
    if (made < want) {
      const label = AUTO_MECHANICS.find((m) => m.key === key)!.label;
      notes.push(`${label}: chỉ dựng được ${made}/${want} — bàn không đủ khẩu hợp lệ.`);
    }
  };

  // ---- Double: đổi số khẩu nên phải làm trước khi chia hàng ----
  if ('double' in options.mechanics) {
    const want = wantedCount('double', options, rng);
    const merged = mergeDoubles(blasters, want, rng);
    blasters = merged.blasters;
    short('double', want, merged.made);
  }

  // Chia hàng lại sau khi số khẩu đã chốt.
  const dockColumns: number[][] = Array.from({ length: rowCount }, () => []);
  const byColorOrder = () => [...blasters].sort((a, b) => a.color - b.color || a.id - b.id);
  if (options.layout === 'grouped') {
    const order = byColorOrder();
    const per = Math.ceil(order.length / rowCount);
    order.forEach((b, i) => dockColumns[Math.min(rowCount - 1, Math.floor(i / per))].push(b.id));
  } else if (options.layout === 'sameHeads') {
    byColorOrder().forEach((b, i) => dockColumns[i % rowCount].push(b.id));
  } else {
    blasters.forEach((b, i) => dockColumns[i % rowCount].push(b.id));
  }

  const pos = positions(dockColumns);
  const heads = dockColumns.filter((c) => c.length).map((c) => c[0]);
  // Một khẩu đầu hàng luôn để trống mọi cơ chế chặn (băng, khoá): thiếu nó là màn bí ngay
  // nước đầu và validateShooters chặn thẳng.
  const freeHead = heads.length ? heads[0] : null;
  const byId = new Map(blasters.map((b) => [b.id, b]));
  const blocked = new Set<number>(); // đã mang cơ chế chặn (băng / ổ khoá)
  const special = new Set<number>(); // đã đổi type (khoá / chìa)

  // ---- Ice ----
  if ('ice' in options.mechanics) {
    const want = wantedCount('ice', options, rng);
    // Băng dày hơn số lượt bấm còn lại thì không bao giờ tan; giữ mỏng và chừa đầu một hàng.
    const maxIce = Math.max(0, Math.min(blasters.length - 1, Math.floor(blasters.length / 2)));
    const pool = shuffled(
      blasters.map((b) => b.id).filter((id) => id !== freeHead),
      rng,
    ).slice(0, Math.min(want, maxIce));
    for (const id of pool) {
      const b = byId.get(id)!;
      b.iceHp = Math.min(randInt(rng, 1, 2), Math.max(1, blasters.length - 1));
      blocked.add(id);
    }
    short('ice', want, pool.length);
  }

  // ---- Lock + Key ----
  if ('lock' in options.mechanics) {
    const want = wantedCount('lock', options, rng);
    // Ổ khoá phải nằm từ bậc 2 trở xuống (bậc 1 của mọi hàng đều là ổ = không rút được gì),
    // chìa phải ở HÀNG KHÁC với ổ nó mở, nếu không thì chính ổ đó chặn đường lấy chìa.
    let made = 0;
    for (let n = 0; n < want; n++) {
      const lockCandidates = shuffled(
        blasters
          .map((b) => b.id)
          .filter(
            (id) =>
              !blocked.has(id) &&
              !special.has(id) &&
              (pos.get(id)?.[1] ?? 0) >= 1,
          ),
        rng,
      );
      const lockId = lockCandidates[0];
      if (lockId == null) break;
      const lockRow = pos.get(lockId)![0];
      const keyId = shuffled(
        blasters
          .map((b) => b.id)
          .filter(
            (id) =>
              id !== lockId &&
              !blocked.has(id) &&
              !special.has(id) &&
              pos.get(id)?.[0] !== lockRow,
          ),
        rng,
      )[0];
      if (keyId == null) break;
      byId.get(lockId)!.type = BLASTER_TYPE_LOCK;
      byId.get(keyId)!.type = BLASTER_TYPE_KEY;
      blocked.add(lockId);
      special.add(lockId);
      special.add(keyId);
      made++;
    }
    short('lock', want, made);
  }

  // ---- Hidden ----
  if ('hidden' in options.mechanics) {
    const want = wantedCount('hidden', options, rng);
    const pool = shuffled(
      blasters.map((b) => b.id).filter((id) => (pos.get(id)?.[1] ?? 0) >= 1),
      rng,
    ).slice(0, want);
    for (const id of pool) byId.get(id)!.isHidden = true;
    short('hidden', want, pool.length);
  }

  // ---- Connected ----
  let linked = blasters;
  if ('connected' in options.mechanics) {
    const want = wantedCount('connected', options, rng);
    // Cùng bậc ở hai hàng khác nhau: đúng nếp của data mẫu (trong game mới vẽ được thanh
    // nối) và không bao giờ rơi vào thế "cùng hàng mà cách nhau một khẩu" bị chặn.
    const slots = new Map<number, number[]>();
    pos.forEach(([, index], id) => {
      const same = slots.get(index) ?? [];
      same.push(id);
      slots.set(index, same);
    });
    const used = new Set<number>();
    const pairs: [number, number][] = [];
    for (const index of shuffled([...slots.keys()], rng)) {
      if (pairs.length >= want) break;
      const ids = shuffled(
        (slots.get(index) ?? []).filter((id) => !used.has(id) && !special.has(id)),
        rng,
      );
      // Ưu tiên cặp cùng số đạn — data mẫu luôn vậy, lệch thì `connectionWarnings` càu nhàu.
      for (let i = 0; i < ids.length && pairs.length < want; i++) {
        const a = byId.get(ids[i])!;
        if (used.has(a.id)) continue;
        const partner =
          ids.slice(i + 1).find((id) => !used.has(id) && byId.get(id)!.bulletCount === a.bulletCount) ??
          ids.slice(i + 1).find((id) => !used.has(id));
        if (partner == null) continue;
        used.add(a.id);
        used.add(partner);
        pairs.push([a.id, partner]);
      }
    }
    linked = blasters;
    for (const [a, b] of pairs) linked = toggleConnection(linked, a, b);
    short('connected', want, pairs.length);
  }

  return { setup: { blasters: linked, dockColumns }, applied, notes };
}

// ---------- Dò tới đúng điểm khó mục tiêu ----------

/**
 * Hệ số nhân áp lên số lượng các cơ chế đang để "tự random" — mỗi hệ số là một phương án
 * để chấm thử. 0 = bỏ hẳn cơ chế tự động (phương án dễ nhất), 3 = nhồi gấp ba.
 *
 * Cơ chế người dựng đã GÕ SỐ thì không bị nhân: gõ 2 băng là phải ra đúng 2 khẩu băng.
 */
const SCALE_STEPS = [0, 0.5, 1, 1.5, 2, 3];

export interface AutoBuildSearchOptions extends AutoBuildOptions {
  /** Hình khối của màn — cần để chấm điểm thật (tường, số màu, độ sâu đều nằm ở đây). */
  grid: VoxelGrid;
  /** Số ô khoang chờ (`LevelData.dockCount`) — ảnh hưởng trực tiếp tới độ khó. */
  dockCount: number;
}

export interface AutoBuildSearchResult extends AutoBuildResult {
  /** Điểm `rateDifficulty` chấm được cho phương án đã chọn. */
  score: number;
  label: string;
  winnable: boolean;
  /** Cách xếp hàng của phương án đã chọn. */
  layout: DockLayout;
  /** Điểm của mọi phương án đã thử, để biết thang còn nới được tới đâu. */
  tried: { scale: number; layout: DockLayout; score: number; winnable: boolean }[];
}

/**
 * Dựng bộ súng rồi TỰ CHẤM để bám đúng điểm khó mục tiêu.
 *
 * Cần thiết vì điểm khó không chỉ nằm ở bộ súng: tường bịt hướng bắn, số màu, số lớp phải
 * bóc và khối lượng màn đã chiếm phần lớn thang điểm. Chỉ suy từ số cơ chế thì trên màn
 * nhiều tường, mức đặt ở thanh trượt luôn thấp hơn điểm thật. Ở đây sinh vài phương án
 * (bớt / giữ / nhồi thêm cơ chế), chấm từng cái bằng đúng `rateDifficulty` của nút Thử giải,
 * rồi giữ cái gần mục tiêu nhất — phương án không giải được thì loại thẳng.
 */
export function autoBuildSearch(
  blockCounts: Map<number, number>,
  options: AutoBuildSearchOptions,
): AutoBuildSearchResult {
  const rng = options.random ?? Math.random;
  const target = clampScore(options.difficultyScore);
  const autoKeys = (Object.keys(options.mechanics) as AutoMechanicKey[]).filter(
    (k) => options.mechanics[k] == null,
  );

  // Không có gì để nới thì khỏi chấm nhiều lần: chỉ số lượng cơ chế tự động mới kéo được
  // điểm. Cơ chế gõ số tay vẫn thử vài lần vì CHỖ ĐẶT cũng đổi độ khó (bó lựa chọn nhiều hay ít).
  const fixedOnly = Object.keys(options.mechanics).length > 0 && autoKeys.length === 0;
  // Mỗi phương án phải chạy cả mô phỏng, mà số phương án = số hệ số × 3 cách xếp. Màn to thì
  // bớt hệ số cho khỏi treo tay người dựng (~0.1-0.3s mỗi lần chấm).
  const steps = autoKeys.length
    ? options.grid.size > 6000
      ? [0, 1.5]
      : options.grid.size > 3000
        ? [0, 1, 2]
        : SCALE_STEPS
    : fixedOnly
      ? [1, 1]
      : [1];

  let best: AutoBuildSearchResult | null = null;
  let bestScale = 1;
  const tried: { scale: number; layout: DockLayout; score: number; winnable: boolean }[] = [];

  // Cách xếp màu trong hàng là cần kéo điểm MẠNH nhất: khoang chờ chỉ 5 ô, nên xếp sao cho
  // khoang dễ bị nhồi toàn một màu là đổi hẳn độ khó — ăn vào `mixing` (1.5) và áp lực khoang
  // chờ (2), trong khi nhồi thêm cơ chế chỉ ăn phần nhẹ hơn. Thử cả ba chứ không đoán theo điểm.
  const layouts: DockLayout[] = options.layout
    ? [options.layout]
    : ['mixed', 'grouped', 'sameHeads'];

  for (const layout of layouts) {
    for (const scale of steps) {
      const mechanics: Partial<Record<AutoMechanicKey, number | null>> = {};
      for (const key of Object.keys(options.mechanics) as AutoMechanicKey[]) {
        const asked = options.mechanics[key];
        if (typeof asked === 'number') {
          mechanics[key] = asked;
          continue;
        }
        const [lo, hi] = mechanicCountRange(key, target);
        const center = (lo + hi) / 2;
        mechanics[key] = Math.max(0, Math.round(center * scale));
      }

      const built = autoBuildShooterSetup(blockCounts, {
        ...options,
        mechanics,
        layout,
        random: rng,
      });
      const input = {
        grid: options.grid,
        blasters: built.setup.blasters,
        dockColumns: built.setup.dockColumns,
        dockCount: options.dockCount,
      };
      const result = checkWinnable(input);
      const rating = rateDifficulty(input, result);
      tried.push({ scale, layout, score: rating.score, winnable: result.winnable });

      const candidate: AutoBuildSearchResult = {
        ...built,
        score: rating.score,
        label: rating.label,
        winnable: result.winnable,
        layout,
        tried,
      };
      if (!best) {
        best = candidate;
        bestScale = scale;
        continue;
      }
      // Giải được luôn thắng phương án không giải được, sau đó mới xét gần mục tiêu;
      // bằng điểm thì lấy phương án ít lệch khỏi số lượng "chuẩn" của mức đó (scale gần 1).
      const better =
        candidate.winnable !== best.winnable
          ? candidate.winnable
          : Math.abs(candidate.score - target) !== Math.abs(best.score - target)
            ? Math.abs(candidate.score - target) < Math.abs(best.score - target)
            : Math.abs(scale - 1) < Math.abs(bestScale - 1);
      if (better) {
        best = candidate;
        bestScale = scale;
      }
    }
  }

  const chosen = best!;
  chosen.tried = tried;

  // Nói rõ khi thang đã kẹt: bớt hết cơ chế mà vẫn cao hơn mục tiêu (hoặc nhồi hết mà vẫn
  // thấp hơn) nghĩa là phần thiếu/thừa nằm ở HÌNH KHỐI, sửa bộ súng không tới được.
  const winnable = tried.filter((t) => t.winnable);
  const pool = winnable.length ? winnable : tried;
  const lowest = Math.min(...pool.map((t) => t.score));
  const highest = Math.max(...pool.map((t) => t.score));
  if (target < lowest - 0.4) {
    chosen.notes.push(
      `Hình khối này tự nó đã ~${lowest} điểm (tường, số màu, số lớp phải bóc, khối lượng màn) — ` +
        `bớt hết cơ chế cũng không xuống tới ${target} được. Muốn dễ hơn thì sửa hình khối hoặc tăng ô khoang chờ.`,
    );
  } else if (target > highest + 0.4) {
    chosen.notes.push(
      `Nhồi tối đa cơ chế cũng chỉ tới ~${highest} điểm — muốn tới ${target} thì phải sửa hình khối ` +
        `(thêm màu, thêm tường che, xếp dồn cùng màu trong một hàng) hoặc giảm ô khoang chờ.`,
    );
  }
  if (!chosen.winnable) {
    chosen.notes.push(
      'Không phương án nào giải được — bấm “Thử giải” để xem mắc ở đâu (thường là khoang chờ quá ít ô).',
    );
  }

  return chosen;
}
