import { VoxelGrid } from './VoxelGrid';
import { BLASTER_TYPES, type BlasterEntry } from './blasters';
import { WALL_COLOR_ID, gameColorById, matchGameColor } from './gameColors';

/**
 * Thử chơi hộ một màn để biết nó có phá hết khối được hay không, và đo xem chơi nó khó tới mức nào.
 *
 * ---- Luật được mô phỏng ----
 * 1. Một khối bắn được khi nó *hở*: có ít nhất một trong 6 mặt không bị khối nào che. Đây đúng là
 *    luật "khối nó nhìn thấy, không bị che, có mặt hướng ra ngoài", và cũng là luật mà
 *    `computeDepths` dùng để tính `depth` — đã kiểm khớp 1331/1331 voxel với data gốc.
 * 2. Khối tường (`ColorType.None`) không bao giờ bị phá và không tính vào điều kiện thắng, nhưng
 *    vẫn che các khối sau nó — nên một khối bị tường bọc kín là một màn không thắng được.
 * 3. Mỗi hàng chờ chỉ với tới được súng ĐẦU hàng; súng đã rút ra thì nằm ở khoang chờ, tối đa
 *    `dockCount` súng cùng lúc.
 * 4. Súng bắn từng viên vào khối hở cùng màu. Hết đạn thì rời khoang, nhường chỗ.
 * 5. Thua = khoang chờ đầy mà không súng nào trong đó còn khối hở cùng màu để bắn (tắc hàng).
 *
 * ---- Chỗ CHƯA mô phỏng (xem `ignoredMechanics` trong kết quả) ----
 * Các loại súng ngoài Normal (chìa/khoá, generator, búa…), `isHidden`, `iceHp`, `isChained` và các
 * danh sách connected/chained/inner đều bị coi như súng thường. Súng hai màu thì có mô phỏng: mỗi
 * màu một túi đạn `bulletCount` riêng — cách tính duy nhất khớp được số khối trong
 * DoubleBlasterBox.asset (494 khối mỗi màu = 8 súng × ~62 đạn × 2 màu).
 */

/** Ô lưới -> `ColorType`. Tường giữ nguyên là 0. */
function colorTypeOf(hex: string): number {
  return matchGameColor(hex).color.id;
}

export interface SolveInput {
  grid: VoxelGrid;
  blasters: BlasterEntry[];
  dockColumns: number[][];
  /** Số ô khoang chờ (`LevelData.dockCount`). */
  dockCount: number;
}

export interface SolveResult {
  /** true = đã tìm ra một thứ tự bấm phá hết khối (chứng minh được, không phải phỏng đoán). */
  winnable: boolean;
  /** Vì sao không thắng được — chỉ có khi `winnable` là false. */
  reason?: string;
  totalBlocks: number;
  blocksLeft: number;
  /** Số khối còn lại theo màu, chỉ các màu chưa phá xong. */
  leftByColor: { colorType: number; count: number }[];
  /** Số lần bấm súng của lời giải tìm được. */
  picks: number;
  /** Lúc căng nhất có bao nhiêu súng nằm trong khoang mà không bắn được. */
  maxStalled: number;
  /** Số lần một súng phải nằm chờ vì chưa có khối hở cùng màu. */
  stalls: number;
  /** Đạn không dùng tới (súng rời khoang khi màu của nó đã hết khối). */
  wastedBullets: number;
  /**
   * 0..1 — trung bình mỗi lượt rút súng thì bao nhiêu phần các hàng đang có súng bấm được ngay.
   * 1 = bấm hàng nào cũng được; gần 0 = mỗi lượt chỉ đúng một hàng dùng được.
   */
  choiceFreedom: number;
  /** Số chiến lược đã thử trước khi ra kết quả. */
  policiesTried: number;
  /** Cơ chế bị bỏ qua khi mô phỏng — kết quả chỉ là gần đúng nếu danh sách này không rỗng. */
  ignoredMechanics: string[];
}

const NEIGHBORS_6: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Chiến lược chọn khối để bắn — thử lần lượt, thắng ở cái nào thì dừng. */
type Policy = 'unlock' | 'shallow' | 'deep' | 'fifo' | 'seed1' | 'seed2' | 'seed3';

const POLICIES: Policy[] = ['unlock', 'shallow', 'deep', 'fifo', 'seed1', 'seed2', 'seed3'];

/** LCG nhỏ để phá thế cân bằng một cách xác định (cùng input -> cùng kết quả). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Pool {
  color: number;
  left: number;
}

interface Queued {
  id: number;
  pools: Pool[];
  /** Thứ tự vào khoang — dùng để ưu tiên súng vào trước. */
  order: number;
}

interface SimState {
  /** key -> colorType. Tường vẫn nằm đây (colorType 0) để tiếp tục che. */
  occupied: Map<string, number>;
  /** Các khối hở, nhóm theo màu. Tường không nằm trong này. */
  exposed: Map<number, Set<string>>;
  /** Số khối màu còn lại theo màu — để biết một súng còn cơ hội bắn hay không. */
  remaining: Map<number, number>;
  blocksLeft: number;
}

function isExposed(occupied: Map<string, number>, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    if (!occupied.has(VoxelGrid.key(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

function buildState(grid: VoxelGrid): SimState {
  const occupied = new Map<string, number>();
  for (const { x, y, z, voxel } of grid.entries()) {
    occupied.set(VoxelGrid.key(x, y, z), colorTypeOf(voxel.color));
  }

  const exposed = new Map<number, Set<string>>();
  const remaining = new Map<number, number>();
  let blocksLeft = 0;
  for (const [key, color] of occupied) {
    if (color === WALL_COLOR_ID) continue;
    blocksLeft++;
    remaining.set(color, (remaining.get(color) ?? 0) + 1);
    const [x, y, z] = VoxelGrid.parseKey(key);
    if (isExposed(occupied, x, y, z)) {
      let set = exposed.get(color);
      if (!set) {
        set = new Set();
        exposed.set(color, set);
      }
      set.add(key);
    }
  }
  return { occupied, exposed, remaining, blocksLeft };
}

/**
 * Phá 1 khối. Trả về các khối vừa hở ra.
 *
 * Khối đã hở thì không bao giờ bị che lại (chỉ có khối bị bớt đi), nên tập khối hở chỉ phình ra —
 * nhờ vậy mô phỏng không cần tính lại toàn bộ bề mặt sau mỗi viên đạn.
 */
function destroy(state: SimState, key: string, color: number): string[] {
  state.occupied.delete(key);
  state.exposed.get(color)?.delete(key);
  state.remaining.set(color, (state.remaining.get(color) ?? 1) - 1);
  state.blocksLeft--;

  const revealed: string[] = [];
  const [x, y, z] = VoxelGrid.parseKey(key);
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    const nk = VoxelGrid.key(x + dx, y + dy, z + dz);
    const nc = state.occupied.get(nk);
    if (nc === undefined || nc === WALL_COLOR_ID) continue;
    let set = state.exposed.get(nc);
    if (!set) {
      set = new Set();
      state.exposed.set(nc, set);
    }
    if (!set.has(nk)) {
      set.add(nk);
      revealed.push(nk);
    }
  }
  return revealed;
}

/** Số mặt hở của một khối — dùng cho chiến lược shallow/deep. */
function openFaces(occupied: Map<string, number>, key: string): number {
  const [x, y, z] = VoxelGrid.parseKey(key);
  let n = 0;
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    if (!occupied.has(VoxelGrid.key(x + dx, y + dy, z + dz))) n++;
  }
  return n;
}

/** Số khối *bị che hoàn toàn* sẽ hở ra nếu phá `key` — để chiến lược "unlock" biết đào chỗ nào. */
function wouldReveal(state: SimState, key: string, wanted: Set<number>): number {
  const [x, y, z] = VoxelGrid.parseKey(key);
  let score = 0;
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    const nk = VoxelGrid.key(x + dx, y + dy, z + dz);
    const nc = state.occupied.get(nk);
    if (nc === undefined || nc === WALL_COLOR_ID) continue;
    if (state.exposed.get(nc)?.has(nk)) continue; // đã hở rồi, phá cái này không mở thêm gì
    score += wanted.has(nc) ? 10 : 1; // mở đúng màu đang bị tắc thì đáng giá hơn nhiều
  }
  return score;
}

/**
 * Số ứng viên tối đa xét khi chọn khối để bắn.
 *
 * Bề mặt một khối 11³ có thể tới ~500 ô hở, mà mỗi viên đạn lại chọn một lần — quét hết làm một lần
 * kiểm mất gần một giây. Xét 64 ô đầu là đủ để chiến lược có cái mà chọn, còn thứ tự trong `Set` thì
 * xác định (theo lúc ô hở ra) nên kết quả không đổi giữa các lần chạy.
 */
const TARGET_SCAN_CAP = 64;

function pickTarget(
  state: SimState,
  color: number,
  policy: Policy,
  stalledColors: Set<number>,
  rand: (() => number) | null,
): string | undefined {
  const set = state.exposed.get(color);
  if (!set || set.size === 0) return undefined;

  if (policy === 'fifo') {
    for (const key of set) return key; // Set giữ thứ tự thêm vào
  }

  if (rand) {
    // Chọn ngẫu nhiên xác định: đi qua tập một lượt, dùng reservoir sampling để không phải đổ ra
    // mảng ở mỗi viên đạn.
    let chosen: string | undefined;
    let seen = 0;
    for (const key of set) {
      seen++;
      if (rand() < 1 / seen) chosen = key;
    }
    return chosen;
  }

  let best: string | undefined;
  let bestScore = -Infinity;
  let scanned = 0;
  for (const key of set) {
    let score: number;
    if (policy === 'unlock') score = wouldReveal(state, key, stalledColors);
    else if (policy === 'shallow') score = openFaces(state.occupied, key);
    else score = -openFaces(state.occupied, key);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
    if (++scanned >= TARGET_SCAN_CAP) break;
  }
  return best;
}

function poolsOf(blaster: BlasterEntry): Pool[] {
  const pools: Pool[] = [{ color: blaster.color, left: blaster.bulletCount }];
  // Súng hai màu: mỗi màu một túi đạn đầy `bulletCount` (xem chú thích đầu file).
  if (blaster.secondaryColor !== WALL_COLOR_ID && blaster.secondaryColor !== blaster.color) {
    pools.push({ color: blaster.secondaryColor, left: blaster.bulletCount });
  }
  return pools;
}

interface SimOutput {
  won: boolean;
  state: SimState;
  picks: number;
  stalls: number;
  maxStalled: number;
  wastedBullets: number;
  /** Có súng nào không? Không có súng thì không phải "tắc" mà là chưa xếp súng. */
  deadlocked: boolean;
  /**
   * Trung bình tỉ lệ "súng đầu hàng bấm được ngay / số hàng còn súng", đo mỗi lần rút súng.
   *
   * 1 = lúc nào bấm hàng nào cũng được (người chơi khỏi phải nghĩ); gần 0 = mỗi lượt chỉ có đúng một
   * hàng dùng được, chọn sai là kẹt. Đây là thứ phân biệt màn khó với màn dễ rõ hơn cả số lần tắc,
   * vì màn dựng tử tế thì hầu như không bao giờ tắc thật.
   */
  choiceFreedom: number;
}

function simulate(input: SolveInput, policy: Policy): SimOutput {
  const state = buildState(input.grid);
  const byId = new Map(input.blasters.map((b) => [b.id, b]));
  const columns = input.dockColumns.map((c) => c.filter((id) => byId.has(id)));
  const cursor = columns.map(() => 0);
  const slots = Math.max(1, input.dockCount);
  const rand = policy.startsWith('seed') ? lcg(Number(policy.slice(4)) * 7919) : null;

  const queue: Queued[] = [];
  let order = 0;
  let picks = 0;
  let stalls = 0;
  let maxStalled = 0;
  let wastedBullets = 0;
  let freedomSum = 0;
  let freedomSamples = 0;

  /** Túi đạn còn dùng được: còn đạn VÀ màu đó còn khối trên bàn. */
  const livePools = (q: Queued) =>
    q.pools.filter((p) => p.left > 0 && (state.remaining.get(p.color) ?? 0) > 0);

  /** Túi bắn được NGAY: còn khối hở cùng màu. */
  const firablePool = (q: Queued) =>
    livePools(q).find((p) => (state.exposed.get(p.color)?.size ?? 0) > 0);

  const canPull = () => cursor.some((c, i) => c < columns[i].length);

  for (let guard = 0; guard < 2_000_000; guard++) {
    if (state.blocksLeft === 0) {
      return {
        won: true,
        state,
        picks,
        stalls,
        maxStalled,
        wastedBullets,
        deadlocked: false,
        choiceFreedom: freedomSamples ? freedomSum / freedomSamples : 1,
      };
    }

    // 1. Súng hết việc thì rời khoang (hết đạn, hoặc màu của nó không còn khối nào).
    for (let i = queue.length - 1; i >= 0; i--) {
      if (livePools(queue[i]).length === 0) {
        wastedBullets += queue[i].pools.reduce((s, p) => s + p.left, 0);
        queue.splice(i, 1);
      }
    }

    // 2. Bắn: ưu tiên súng vào khoang trước (đúng cảm giác chơi, và giữ khoang thoáng).
    const shooters = queue
      .filter((q) => firablePool(q))
      .sort((a, b) => a.order - b.order);
    if (shooters.length) {
      const q = shooters[0];
      const stalledColors = new Set(
        queue.filter((x) => !firablePool(x)).flatMap((x) => livePools(x).map((p) => p.color)),
      );
      const pool = firablePool(q)!;
      const target = pickTarget(state, pool.color, policy, stalledColors, rand);
      if (target) {
        destroy(state, target, pool.color);
        pool.left--;
        continue;
      }
    }

    // 3. Rút thêm súng từ đầu các hàng nếu khoang còn chỗ.
    if (queue.length < slots && canPull()) {
      let bestColumn = -1;
      let bestScore = -Infinity;
      let fronts = 0;
      let firableFronts = 0;
      for (let i = 0; i < columns.length; i++) {
        if (cursor[i] >= columns[i].length) continue;
        const blaster = byId.get(columns[i][cursor[i]])!;
        const pools = poolsOf(blaster);
        // Ưu tiên súng bắn được ngay; sau đó tới màu còn nhiều khối (kiểu gì cũng phải dùng).
        const nowFirable = pools.some((p) => (state.exposed.get(p.color)?.size ?? 0) > 0);
        const remain = pools.reduce((s, p) => s + (state.remaining.get(p.color) ?? 0), 0);
        fronts++;
        if (nowFirable) firableFronts++;
        const score = (nowFirable ? 1_000_000 : 0) + remain;
        if (score > bestScore) {
          bestScore = score;
          bestColumn = i;
        }
      }
      if (fronts > 0) {
        freedomSum += firableFronts / fronts;
        freedomSamples++;
      }
      if (bestColumn >= 0) {
        const blaster = byId.get(columns[bestColumn][cursor[bestColumn]])!;
        cursor[bestColumn]++;
        queue.push({ id: blaster.id, pools: poolsOf(blaster), order: order++ });
        picks++;
        const stalled = queue.filter((q) => !firablePool(q)).length;
        maxStalled = Math.max(maxStalled, stalled);
        if (stalled > 0) stalls++;
        continue;
      }
    }

    // 4. Không bắn được, không rút được -> tắc.
    return {
      won: false,
      state,
      picks,
      stalls,
      maxStalled: Math.max(maxStalled, queue.length),
      wastedBullets,
      deadlocked: queue.length > 0 || canPull(),
      choiceFreedom: freedomSamples ? freedomSum / freedomSamples : 1,
    };
  }

  return {
    won: false,
    state,
    picks,
    stalls,
    maxStalled,
    wastedBullets,
    deadlocked: true,
    choiceFreedom: freedomSamples ? freedomSum / freedomSamples : 1,
  };
}

/** Cơ chế có trong data nhưng mô phỏng chưa xử — để nói rõ kết quả chỉ là gần đúng. */
function ignoredMechanics(blasters: BlasterEntry[]): string[] {
  const out: string[] = [];
  const types = [...new Set(blasters.filter((b) => b.type !== 0).map((b) => b.type))];
  if (types.length) {
    out.push(
      `súng loại ${types
        .map((t) => BLASTER_TYPES.find((x) => x.id === t)?.name ?? t)
        .join(', ')} (coi như súng thường)`,
    );
  }
  if (blasters.some((b) => b.isHidden)) out.push('súng ẩn (isHidden)');
  if (blasters.some((b) => b.iceHp > 0)) out.push('súng bọc băng (iceHp)');
  if (blasters.some((b) => b.isChained)) out.push('súng bị khoá xích (isChained)');
  if (blasters.some((b) => b.connectedBlasterIds.length)) out.push('súng nối nhau (connected)');
  if (blasters.some((b) => b.innerBlasterIds.length)) out.push('súng lồng trong (inner)');
  return out;
}

/** Thử giải màn: chạy lần lượt các chiến lược, thắng ở cái nào thì trả về ngay. */
export function checkWinnable(input: SolveInput): SolveResult {
  const ignored = ignoredMechanics(input.blasters);
  const base = buildState(input.grid);
  const totalBlocks = base.blocksLeft;

  const shape = (sim: SimOutput, tried: number, reason?: string): SolveResult => ({
    winnable: sim.won,
    reason,
    totalBlocks,
    blocksLeft: sim.state.blocksLeft,
    leftByColor: [...sim.state.remaining.entries()]
      .filter(([, n]) => n > 0)
      .map(([colorType, count]) => ({ colorType, count }))
      .sort((a, b) => b.count - a.count),
    picks: sim.picks,
    maxStalled: sim.maxStalled,
    stalls: sim.stalls,
    wastedBullets: sim.wastedBullets,
    choiceFreedom: sim.choiceFreedom,
    policiesTried: tried,
    ignoredMechanics: ignored,
  });

  if (totalBlocks === 0) {
    const empty = simulate(input, 'fifo');
    return { ...shape(empty, 0, 'Chưa có khối màu nào để bắn.'), winnable: false };
  }
  if (!input.blasters.length) {
    const none = simulate(input, 'fifo');
    return { ...shape(none, 0, 'Chưa có súng nào.'), winnable: false };
  }

  let worst: SimOutput | undefined;
  for (let i = 0; i < POLICIES.length; i++) {
    const sim = simulate(input, POLICIES[i]);
    if (sim.won) return shape(sim, i + 1);
    // Giữ lần chạy phá được nhiều nhất để báo cáo cho sát thực tế nhất.
    if (!worst || sim.state.blocksLeft < worst.state.blocksLeft) worst = sim;
  }

  const sim = worst!;
  const left = [...sim.state.remaining.entries()].filter(([, n]) => n > 0);
  const stuck = left
    .map(([c, n]) => `${gameColorById(c)?.name ?? c} (${n} khối)`)
    .slice(0, 4)
    .join(', ');
  const reason = sim.deadlocked
    ? `Tắc hàng: khoang chờ đầy mà không súng nào còn khối hở cùng màu. Còn ${sim.state.blocksLeft} khối: ${stuck}.`
    : `Hết súng mà còn ${sim.state.blocksLeft} khối: ${stuck}.`;
  return shape(sim, POLICIES.length, reason);
}

// ---------- Thang độ khó 0..10 ----------

export interface DifficultyFactor {
  key: string;
  label: string;
  /** 0..1 — mức độ khó của riêng yếu tố này. */
  value: number;
  weight: number;
  /** Con số thật đứng sau `value`, để người dựng level hiểu vì sao. */
  detail: string;
}

export interface DifficultyReport {
  /** 0..10, một chữ số thập phân. */
  score: number;
  label: string;
  /** `LevelDifficulty` gợi ý: 0 Normal, 1 Hard, 2 VeryHard. */
  suggestedDifficulty: number;
  factors: DifficultyFactor[];
}

/**
 * Trọng số của thang độ khó. Để lộ ra ngoài để chỉnh: đây là thang do tool tự đặt (data không có
 * sẵn thang nào), nên nó chỉ đáng tin ở chỗ *so sánh giữa các màn* — con số tuyệt đối thì tuỳ cách
 * chấm ở đây.
 *
 * Áp lực khoang chờ ăn trọng số nặng nhất vì đó là thứ duy nhất làm người chơi *thua*; các yếu tố
 * còn lại chỉ làm màn dài và rối hơn.
 */
const WEIGHTS = {
  /** Bao nhiêu lượt bấm là "chỉ có một đường đúng" — thứ phân biệt màn khó rõ nhất. */
  choice: 2.5,
  queuePressure: 2,
  stallRate: 1,
  colors: 2,
  depth: 1.5,
  buried: 1,
  mixing: 1.5,
  size: 1,
  mechanics: 0.5,
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Số khối hở ngay từ đầu / tổng khối — phần còn lại phải đào mới bắn được. */
function buriedShare(grid: VoxelGrid): { share: number; buried: number; total: number } {
  const state = buildState(grid);
  let exposedCount = 0;
  for (const set of state.exposed.values()) exposedCount += set.size;
  const total = state.blocksLeft;
  const buried = total - exposedCount;
  return { share: total ? buried / total : 0, buried, total };
}

/**
 * Số lần đổi màu dọc theo các hàng chờ / số cặp liền nhau.
 *
 * Chú ý chiều: hàng XEN màu là hàng DỄ — đầu các hàng lúc nào cũng có nhiều màu để chọn. Hàng xếp
 * cứng một màu mới là hàng khó, vì muốn tới màu bên dưới thì phải tiêu hết cả cụm màu trên. Đo bằng
 * mô phỏng cũng ra vậy: hàng xếp cứng chỉ còn 82% lượt bấm là "hàng nào cũng được", hàng trộn thì
 * 100%. Nên bên `rateDifficulty` lấy `1 - ratio` chứ không phải `ratio`.
 */
function mixingRatio(
  dockColumns: number[][],
  byId: Map<number, BlasterEntry>,
): { ratio: number; changes: number; pairs: number } {
  let changes = 0;
  let pairs = 0;
  for (const column of dockColumns) {
    for (let i = 1; i < column.length; i++) {
      const a = byId.get(column[i - 1]);
      const b = byId.get(column[i]);
      if (!a || !b) continue;
      pairs++;
      if (a.color !== b.color) changes++;
    }
  }
  return { ratio: pairs ? changes / pairs : 0, changes, pairs };
}

/**
 * Chấm độ khó 0..10 từ hình khối + cách xếp súng + số đo lúc mô phỏng.
 *
 * Màn không giải được thì không chấm (trả 10 và nói rõ) — "khó 8/10" với một màn không thể thắng là
 * con số vô nghĩa.
 */
export function rateDifficulty(input: SolveInput, result: SolveResult): DifficultyReport {
  const byId = new Map(input.blasters.map((b) => [b.id, b]));
  const slots = Math.max(1, input.dockCount);

  const colors = new Set<number>();
  let maxDepthProxy = 0;
  {
    // depth ở đây = số lớp phải bóc, lấy luôn từ hình khối chứ không đọc từ layer đã ép tay.
    const state = buildState(input.grid);
    for (const [color, n] of state.remaining) if (n > 0) colors.add(color);
    // Bóc lớp: đếm bao nhiêu vòng mới sạch.
    const work = buildState(input.grid);
    while (work.blocksLeft > 0 && maxDepthProxy < 64) {
      const shell: { key: string; color: number }[] = [];
      for (const [color, set] of work.exposed) {
        for (const key of set) shell.push({ key, color });
      }
      if (!shell.length) break; // còn khối nhưng bị tường bọc kín
      for (const { key, color } of shell) destroy(work, key, color);
      maxDepthProxy++;
    }
  }

  const buried = buriedShare(input.grid);
  const mixing = mixingRatio(input.dockColumns, byId);
  const mechanics = result.ignoredMechanics.length;

  const freedomPercent = Math.round(result.choiceFreedom * 100);
  const factors: DifficultyFactor[] = [
    {
      key: 'choice',
      label: 'Bị bó lựa chọn',
      value: clamp01(1 - result.choiceFreedom),
      weight: WEIGHTS.choice,
      detail: `mỗi lượt bấm chỉ ~${freedomPercent}% số hàng là dùng được ngay`,
    },
    {
      key: 'queuePressure',
      label: 'Áp lực khoang chờ',
      value: clamp01(result.maxStalled / slots),
      weight: WEIGHTS.queuePressure,
      detail: `lúc căng nhất ${result.maxStalled}/${slots} ô khoang bị súng chưa bắn được chiếm`,
    },
    {
      key: 'stallRate',
      label: 'Tần suất phải chờ',
      value: clamp01(result.picks ? result.stalls / result.picks : 0),
      weight: WEIGHTS.stallRate,
      detail: `${result.stalls} lần chờ / ${result.picks} lần bấm`,
    },
    {
      key: 'colors',
      label: 'Số màu',
      value: clamp01((colors.size - 1) / 5),
      weight: WEIGHTS.colors,
      detail: `${colors.size} màu (1 màu = dễ nhất, 6+ màu = kín thang)`,
    },
    {
      key: 'depth',
      label: 'Số lớp phải bóc',
      value: clamp01((maxDepthProxy - 1) / 11),
      weight: WEIGHTS.depth,
      detail: `${maxDepthProxy} lớp từ vỏ vào tâm`,
    },
    {
      key: 'buried',
      label: 'Khối bị che lúc đầu',
      value: clamp01(buried.share),
      weight: WEIGHTS.buried,
      detail: `${buried.buried}/${buried.total} khối chưa hở, phải đào mới bắn được`,
    },
    {
      key: 'mixing',
      label: 'Hàng chờ dồn cùng màu',
      value: mixing.pairs ? clamp01(1 - mixing.ratio) : 0,
      weight: WEIGHTS.mixing,
      detail: mixing.pairs
        ? `${mixing.pairs - mixing.changes}/${mixing.pairs} cặp liền nhau cùng màu (dồn cùng màu = khó hơn)`
        : 'hàng chỉ có 1 súng, không xét',
    },
    {
      key: 'size',
      label: 'Khối lượng màn',
      value: clamp01((result.totalBlocks - 100) / 1400),
      weight: WEIGHTS.size,
      detail: `${result.totalBlocks} khối (100 = ngắn, 1500 = dài)`,
    },
    {
      key: 'mechanics',
      label: 'Cơ chế đặc biệt',
      value: clamp01(mechanics / 3),
      weight: WEIGHTS.mechanics,
      detail: mechanics ? result.ignoredMechanics.join('; ') : 'không có',
    },
  ];

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const raw = factors.reduce((s, f) => s + f.value * f.weight, 0) / totalWeight;
  const score = result.winnable ? Math.round(raw * 100) / 10 : 10;

  const label = !result.winnable
    ? 'Không giải được'
    : score < 2
      ? 'Rất dễ'
      : score < 4
        ? 'Dễ'
        : score < 6
          ? 'Vừa'
          : score < 8
            ? 'Khó'
            : 'Rất khó';

  // Ánh xạ sang enum `LevelDifficulty` của game (0 Normal / 1 Hard / 2 VeryHard).
  const suggestedDifficulty = score < 4 ? 0 : score < 7 ? 1 : 2;

  return { score, label, suggestedDifficulty, factors };
}
