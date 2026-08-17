import { VoxelGrid } from './VoxelGrid';
import {
  BLASTER_TYPES,
  BLASTER_TYPE_KEY,
  BLASTER_TYPE_LOCK,
  BLASTER_TYPE_NORMAL,
  bulletCountsByColor,
  connectedGroups,
  type BlasterEntry,
} from './blasters';
import { WALL_COLOR_ID, gameColorById, matchGameColor } from './gameColors';

/**
 * Thử chơi hộ một màn để biết nó có phá hết khối được hay không, và đo xem chơi nó khó tới mức nào.
 *
 * ---- Luật được mô phỏng ----
 * 1. Một khối bắn được khi có ít nhất một mặt hở ra vùng khí THÔNG VỚI BÊN NGOÀI — đúng chữ "có mặt
 *    hướng ra ngoài". Chỉ đếm "có ô trống bên cạnh" là chưa đủ: một khối nằm trong hốc rỗng kín
 *    cũng có ô trống bên cạnh mà ngoài kia chẳng bắn vào được. Khác biệt này chỉ lộ ra khi có
 *    tường quây thành hốc — đo trên cả 7 file DataExample thì hai cách tính ra y hệt nhau
 *    (Banana 408, WallBox 488…), nên đổi sang cách chặt hơn không phá gì của data cũ.
 * 2. Khối tường (`ColorType.None`) không bao giờ bị phá và không tính vào điều kiện thắng, nhưng
 *    vẫn che các khối sau nó và vẫn chặn vùng khí — đó chính là công dụng của nó: bịt một hướng để
 *    người chơi phải xoay sang góc khác. Khối bị tường quây kín thì không bao giờ bắn được.
 * 3. Mỗi hàng chờ chỉ với tới được súng ĐẦU hàng; súng đã rút ra thì nằm ở khoang chờ, tối đa
 *    `dockCount` súng cùng lúc (game chỉ có 5 ô — xem `MAX_DOCK_COUNT`).
 * 4. Súng bắn từng viên vào khối hở cùng màu. HẾT VIỆC thì biến mất, chừa lại ô trống. "Hết việc"
 *    tính theo ĐƠN VỊ rút chứ không theo từng khẩu:
 *      - súng lẻ: cạn đạn là đi ngay;
 *      - súng hai màu: phải cạn CẢ HAI túi mới đi;
 *      - cụm nối nhau: phải MỌI thành viên cạn đạn thì cả cụm mới cùng biến mất — khẩu hết đạn
 *        sớm vẫn tiếp tục chiếm ô khoang, chờ bạn nối của nó bắn xong.
 * 5. Súng nối nhau (`connectedBlasterIds`) là MỘT đơn vị: cả nhóm cùng lên khoang một lượt, nên
 *    phải đủ chỗ trống cho cả nhóm (cụm 3 khẩu mà khoang chỉ còn 2 ô thì không nhấc được) và mọi
 *    thành viên phải đang ở đầu hàng của nó. Lên khoang rồi thì mỗi súng bắn màu của riêng nó.
 *    Suy ra từ ConnectedBox.asset: cả 4 cặp đều là hai súng cùng một bậc ở hai hàng cạnh nhau,
 *    cùng số đạn, khác màu — tức là hai khẩu bị buộc vào nhau nên phải bay lên cùng lúc.
 * 6. Súng bọc băng (`iceHp` > 0) không bấm được. Mỗi LƯỢT BẤM (nhấc một khẩu — hoặc cả cặp nối
 *    nhau — lên khoang) làm băng của MỌI khẩu còn băng tan 1; về 0 thì bấm được.
 *    Khớp với IcedBlasterBox.asset: hai đầu hàng H1/H3 băng 10, mà H2 có đúng 12 khẩu để bấm trong
 *    lúc chờ; khẩu băng 15 nằm ở bậc 11 của H2, tới lượt nó thì băng vừa kịp tan.
 * 7. Ổ khoá (`BlasterType.Lock`) nằm ngay trong hàng và chưa mở thì không bấm được — mà hàng chỉ
 *    rút được từ đầu, nên mọi khẩu xếp sau nó cũng kẹt theo. Chìa (`BlasterType.Key`) là một khẩu
 *    bình thường, hễ được nhấc lên khoang là mở một ổ.
 *    LƯU Ý: data KHÔNG lưu chìa nào mở ổ nào — cả 4 khẩu Key/Lock trong KeyLockBox.asset đều có
 *    connected/chained/inner rỗng. Nên ở đây mô phỏng theo giả định yếu nhất mà data cho phép:
 *    một chìa mở MỘT ổ bất kỳ còn khoá (chọn ổ ở hàng gần đầu nhất cho xác định). Nếu game ghép
 *    cặp chìa–ổ theo luật riêng thì chỗ này phải sửa lại.
 * 8. Thua = khoang chờ đầy mà không súng nào trong đó còn khối hở cùng màu để bắn (tắc hàng), hoặc
 *    không rút nổi nhóm nào nữa (nhóm nối nhau thiếu chỗ, mọi đầu hàng đóng băng, hoặc còn ổ khoá
 *    mà hết chìa).
 *
 * ---- Hidden: cố ý KHÔNG đưa vào luật thắng/thua ----
 * `isHidden` chỉ giấu màu với NGƯỜI CHƠI, không đổi luật vật lý nào: vẫn bấm được, vẫn bắn đúng màu
 * thật. Một màn giải được thì vẫn giải được, chỉ là người chơi phải mò. Nên nó không nằm ở
 * `checkWinnable` (kết quả sẽ vẫn đúng) mà nằm ở thang độ khó — và kết quả thử giải có kèm lời nhắc
 * rằng đây là mức chơi với thông tin đầy đủ, tức giới hạn TRÊN của người chơi thật.
 *
 * 9. Súng hai màu (`secondaryColor` khác None): mỗi màu MỘT túi đạn riêng, cùng bằng `bulletCount` —
 *    `BlasterData` chỉ có đúng một trường đếm đạn, và chỉ cách hiểu này mới khớp số khối trong
 *    DoubleBlasterBox.asset (mỗi màu 494 khối = tổng 494 đạn của 8 khẩu, dùng cho cả hai màu).
 *    Phải bắn HẾT màu thứ nhất mới sang màu thứ hai — nên khẩu hai màu có thể nằm chờ trong khoang
 *    dù màu phụ của nó đang có khối hở. Ngoại lệ: nếu màu thứ nhất đã sạch khối trên bàn thì số đạn
 *    còn lại của nó thành đạn phí và khẩu chuyển sang màu thứ hai, chứ không kẹt vĩnh viễn.
 *
 * ---- Chỗ CHƯA mô phỏng (xem `ignoredMechanics` trong kết quả) ----
 * Các loại súng ngoài Normal (chìa/khoá, generator, búa…), `isChained` và các
 * danh sách chained/inner đều bị coi như súng thường. Súng hai màu thì có mô phỏng: mỗi màu một túi
 * đạn `bulletCount` riêng — cách tính duy nhất khớp được số khối trong DoubleBlasterBox.asset
 * (494 khối mỗi màu = 8 súng × ~62 đạn × 2 màu).
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
  /**
   * Số khẩu giấu màu. >0 nghĩa là lời giải này chơi với thông tin đầy đủ, còn người chơi thật phải
   * mò — kết quả "win được" là giới hạn trên, không phải thứ ai cũng đạt được.
   */
  hiddenCount: number;
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
  /**
   * Mã ĐƠN VỊ rút: các khẩu nối nhau được nhấc cùng lượt thì cùng mã này. Cả đơn vị chỉ
   * biến mất khi MỌI thành viên bắn xong, nên một khẩu hết đạn sớm vẫn tiếp tục chiếm ô
   * khoang — đúng luật game, và là chỗ khiến cụm nối nhau đắt hơn nhiều so với súng lẻ.
   */
  unit: number;
}

interface SimState {
  /** key -> colorType. Tường vẫn nằm đây (colorType 0) để tiếp tục che. */
  occupied: Map<string, number>;
  /** Các khối hở, nhóm theo màu. Tường không nằm trong này. */
  exposed: Map<number, Set<string>>;
  /** Số khối màu còn lại theo màu — để biết một súng còn cơ hội bắn hay không. */
  remaining: Map<number, number>;
  blocksLeft: number;
  /** Ô trống thông được ra ngoài. Hốc rỗng kín KHÔNG nằm trong này. */
  outside: Set<string>;
  /** Hộp bao đã nới 1 ô mỗi phía — giới hạn cho phép loang khí. */
  lo: [number, number, number];
  hi: [number, number, number];
}

/** Đánh dấu khối màu cạnh ô khí `airKey` là bắn được. */
function markExposedAround(state: SimState, airKey: string): void {
  const [x, y, z] = VoxelGrid.parseKey(airKey);
  for (const [dx, dy, dz] of NEIGHBORS_6) {
    const nk = VoxelGrid.key(x + dx, y + dy, z + dz);
    const color = state.occupied.get(nk);
    if (color === undefined || color === WALL_COLOR_ID) continue;
    let set = state.exposed.get(color);
    if (!set) {
      set = new Set();
      state.exposed.set(color, set);
    }
    set.add(nk);
  }
}

/**
 * Loang vùng khí ngoài trời bắt đầu từ `seeds`, và đánh dấu mọi khối chạm vào vùng vừa loang.
 *
 * Vì khối chỉ mất đi chứ không mọc thêm, vùng khí ngoài chỉ phình ra — nên mỗi ô chỉ vào đây đúng
 * một lần, cả ván cộng lại vẫn là O(số ô).
 */
function floodOutside(state: SimState, seeds: string[]): void {
  const stack: string[] = [];
  for (const seed of seeds) {
    if (state.outside.has(seed) || state.occupied.has(seed)) continue;
    state.outside.add(seed);
    stack.push(seed);
  }
  while (stack.length) {
    const key = stack.pop()!;
    markExposedAround(state, key);
    const [x, y, z] = VoxelGrid.parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS_6) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < state.lo[0] || nx > state.hi[0]) continue;
      if (ny < state.lo[1] || ny > state.hi[1]) continue;
      if (nz < state.lo[2] || nz > state.hi[2]) continue;
      const nk = VoxelGrid.key(nx, ny, nz);
      if (state.outside.has(nk) || state.occupied.has(nk)) continue;
      state.outside.add(nk);
      stack.push(nk);
    }
  }
}

function buildState(grid: VoxelGrid): SimState {
  const occupied = new Map<string, number>();
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { x, y, z, voxel } of grid.entries()) {
    occupied.set(VoxelGrid.key(x, y, z), colorTypeOf(voxel.color));
    lo[0] = Math.min(lo[0], x - 1);
    lo[1] = Math.min(lo[1], y - 1);
    lo[2] = Math.min(lo[2], z - 1);
    hi[0] = Math.max(hi[0], x + 1);
    hi[1] = Math.max(hi[1], y + 1);
    hi[2] = Math.max(hi[2], z + 1);
  }

  const remaining = new Map<number, number>();
  let blocksLeft = 0;
  for (const color of occupied.values()) {
    if (color === WALL_COLOR_ID) continue;
    blocksLeft++;
    remaining.set(color, (remaining.get(color) ?? 0) + 1);
  }

  const state: SimState = {
    occupied,
    exposed: new Map(),
    remaining,
    blocksLeft,
    outside: new Set(),
    lo,
    hi,
  };
  if (occupied.size) {
    // Góc ngoài cùng chắc chắn là khí ngoài trời (hộp bao đã nới thêm 1 ô).
    floodOutside(state, [VoxelGrid.key(lo[0], lo[1], lo[2])]);
  }
  return state;
}

/**
 * Phá 1 khối: ô của nó thành khí, khí ngoài trời loang vào, khối nào vừa lộ mặt ra thì bắn được.
 *
 * Chỉ phá khối đang hở nên ô vừa trống chắc chắn dính vùng khí ngoài — và nếu nó vừa chọc thủng một
 * hốc kín thì cả hốc đó cũng thành khí ngoài trong cùng lượt loang này.
 */
function destroy(state: SimState, key: string, color: number): void {
  state.occupied.delete(key);
  state.exposed.get(color)?.delete(key);
  state.remaining.set(color, (state.remaining.get(color) ?? 1) - 1);
  state.blocksLeft--;
  floodOutside(state, [key]);
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
  /** >0 = nghẽn vì một nhóm nối nhau cần nhiều chỗ hơn cả khoang chờ (số chỗ nhóm cần). */
  groupNeedsSlots: number;
  /** Súng còn nằm trong khoang lúc dừng, kèm màu nó đang chờ khối hở. */
  queueAtEnd: { id: number; colors: number[] }[];
  /** Số súng chưa được rút khỏi các hàng lúc dừng. */
  unpulled: number;
  /**
   * Nhóm nối nhau đang chặn đầu một hàng lúc dừng, kèm lý do không rút được:
   *  gap      — hai khẩu cùng hàng nhưng có khẩu khác chen giữa (hỏng vĩnh viễn)
   *  unplaced — một thành viên chưa được xếp vào hàng nào
   *  slots    — nhóm đông hơn cả khoang chờ
   *  deep     — thành viên còn nằm sâu trong một hàng khác
   */
  stuckGroups: { ids: number[]; why: 'gap' | 'unplaced' | 'slots' | 'deep' }[];
  /** Đầu hàng còn đóng băng lúc dừng, kèm số băng còn lại. */
  frozenHeads: { id: number; left: number }[];
  /** Ổ khoá đang chặn đầu hàng lúc dừng. */
  lockedHeads: number[];
  /** Số chìa chưa dùng còn nằm đâu đó lúc dừng — hết chìa mà còn ổ là bế tắc vĩnh viễn. */
  keysLeft: number;
  /** Số hàng vẫn còn súng lúc dừng — so với `frozenHeads` để biết có phải kẹt vì băng hết không. */
  columnsWithBlasters: number;
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
  let unitSeq = 0;
  let picks = 0;
  let stalls = 0;
  let maxStalled = 0;
  let wastedBullets = 0;
  let freedomSum = 0;
  let freedomSamples = 0;

  /** Túi đạn còn dùng được: còn đạn VÀ màu đó còn khối trên bàn. */
  const livePools = (q: Queued) =>
    q.pools.filter((p) => p.left > 0 && (state.remaining.get(p.color) ?? 0) > 0);

  /**
   * Túi ĐANG tới lượt. Súng hai màu phải bắn xong màu thứ nhất mới sang màu thứ hai, nên chỉ có túi
   * đầu tiên còn dùng được là được bắn — `livePools` giữ nguyên thứ tự [màu chính, màu phụ].
   *
   * Túi màu thứ nhất mà hết khối trên bàn thì `livePools` tự loại nó, khẩu chuyển sang màu thứ hai
   * (đạn thừa tính vào `wastedBullets`) — không thì nó kẹt vĩnh viễn vì một màu đã bị khẩu khác dọn
   * sạch hộ.
   */
  const activePool = (q: Queued): Pool | undefined => livePools(q)[0];

  /** Túi bắn được NGAY: đang tới lượt và còn khối hở cùng màu. */
  const firablePool = (q: Queued) => {
    const pool = activePool(q);
    return pool && (state.exposed.get(pool.color)?.size ?? 0) > 0 ? pool : undefined;
  };

  // Băng còn lại của từng khẩu. Chỉ giảm khi có lượt bấm, nên nếu không bấm được gì nữa thì băng
  // đứng yên vĩnh viễn — đó chính là kiểu tắc riêng của cơ chế này.
  const ice = new Map<number, number>();
  for (const blaster of input.blasters) {
    if (blaster.iceHp > 0) ice.set(blaster.id, blaster.iceHp);
  }

  // Ổ khoá còn khoá. Mở dần mỗi khi nhấc được một khẩu Key lên khoang.
  const locked = new Set<number>();
  for (const blaster of input.blasters) {
    if (blaster.type === BLASTER_TYPE_LOCK) locked.add(blaster.id);
  }

  // Nhóm súng nối nhau: cả nhóm lên khoang một lượt.
  const groupOf = new Map<number, number[]>();
  for (const group of connectedGroups(input.blasters)) {
    for (const id of group) groupOf.set(id, group);
  }

  /** Vị trí còn lại của một súng trong các hàng: [hàng, bậc], hoặc null nếu đã rút / chưa xếp. */
  const pendingPosition = (id: number): [number, number] | null => {
    for (let i = 0; i < columns.length; i++) {
      const index = columns[i].indexOf(id);
      if (index >= cursor[i]) return [i, index];
    }
    return null;
  };

  /**
   * Nhóm rút được ngay: ở MỖI hàng nó có mặt, các thành viên phải nằm liền mạch ngay từ đầu hàng —
   * tức bậc cursor, cursor+1, … Một luật này gói đủ ba trường hợp:
   *  - mỗi khẩu một hàng: ai cũng phải đang ở đầu hàng;
   *  - hai khẩu cùng hàng đứng sát nhau: nhấc khẩu trước thì khẩu sau lên theo — hợp lệ;
   *  - hai khẩu cùng hàng nhưng có khẩu khác chen giữa: khẩu chen giữa không đi cùng được nên
   *    nhóm không bao giờ rút được.
   * Ngoài ra khoang chờ phải còn đủ chỗ cho cả nhóm.
   */
  const pullableGroup = (row: number, freeSlots: number): number[] | null => {
    const head = columns[row][cursor[row]];
    const group = groupOf.get(head) ?? [head];
    if (group.length > freeSlots) return null;

    const byColumn = new Map<number, number[]>();
    for (const id of group) {
      if ((ice.get(id) ?? 0) > 0) return null; // còn băng thì không bấm được
      if (locked.has(id)) return null; // ổ khoá chưa mở thì không bấm được (và chặn cả hàng sau nó)
      const at = pendingPosition(id);
      if (!at) return null; // thành viên chưa xếp vào hàng nào (hoặc đã rút) -> cả nhóm kẹt
      const list = byColumn.get(at[0]);
      if (list) list.push(at[1]);
      else byColumn.set(at[0], [at[1]]);
    }
    for (const [column, indices] of byColumn) {
      indices.sort((a, b) => a - b);
      for (let k = 0; k < indices.length; k++) {
        if (indices[k] !== cursor[column] + k) return null;
      }
    }
    return group;
  };

  /**
   * Ổ nào được mở khi có một chìa lên khoang.
   *
   * Ưu tiên ổ đang nằm ngay đầu một hàng: đó là ổ duy nhất thực sự chặn đường lúc này, mở ổ nằm sâu
   * bên trong thì hàng vẫn tắc y như cũ. Không còn ổ nào chặn đầu hàng thì mở đại một ổ.
   */
  const pickLockToOpen = (): number => {
    for (let i = 0; i < columns.length; i++) {
      if (cursor[i] >= columns[i].length) continue;
      const head = columns[i][cursor[i]];
      if (locked.has(head)) return head;
    }
    return [...locked][0];
  };

  const canPull = () => {
    const free = slots - queue.length;
    for (let i = 0; i < columns.length; i++) {
      if (cursor[i] >= columns[i].length) continue;
      if (pullableGroup(i, free)) return true;
    }
    return false;
  };

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
        groupNeedsSlots: 0,
        queueAtEnd: [],
        unpulled: 0,
        stuckGroups: [],
        frozenHeads: [],
        lockedHeads: [],
        keysLeft: 0,
        columnsWithBlasters: 0,
        choiceFreedom: freedomSamples ? freedomSum / freedomSamples : 1,
      };
    }

    // 1. Rời khoang theo ĐƠN VỊ rút, không theo từng khẩu: một khẩu hết đạn mà bạn nối của nó
    //    còn đạn thì cả cụm vẫn nằm đó chiếm ô. Súng lẻ là đơn vị một khẩu nên rời ngay.
    //    Súng hai màu phải cạn cả hai túi (`livePools` đã tính cả hai) mới coi là hết việc.
    const doneUnits = new Set<number>();
    const liveUnits = new Set<number>();
    for (const q of queue) {
      if (livePools(q).length === 0) doneUnits.add(q.unit);
      else liveUnits.add(q.unit);
    }
    for (const unit of liveUnits) doneUnits.delete(unit);
    if (doneUnits.size) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (!doneUnits.has(queue[i].unit)) continue;
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
      // Khẩu đang kẹt chỉ chờ đúng màu tới lượt của nó, không phải mọi màu nó mang: đào để mở màu
      // phụ trong khi nó còn chưa bắn xong màu chính thì chẳng giúp được gì.
      const stalledColors = new Set(
        queue
          .filter((x) => !firablePool(x))
          .map((x) => activePool(x)?.color)
          .filter((c): c is number => c !== undefined),
      );
      const pool = firablePool(q)!;
      const target = pickTarget(state, pool.color, policy, stalledColors, rand);
      if (target) {
        destroy(state, target, pool.color);
        pool.left--;
        continue;
      }
    }

    // 3. Rút thêm súng từ đầu các hàng nếu khoang còn chỗ. Đơn vị rút là NHÓM nối nhau.
    if (queue.length < slots) {
      const free = slots - queue.length;
      let bestGroup: number[] | null = null;
      let bestScore = -Infinity;
      let fronts = 0;
      let firableFronts = 0;
      for (let i = 0; i < columns.length; i++) {
        if (cursor[i] >= columns[i].length) continue;
        const group = pullableGroup(i, free);
        fronts++;
        if (!group) continue; // đầu hàng này bị buộc vào nhóm chưa rút được -> lượt này không tính
        const pools = group.flatMap((id) => poolsOf(byId.get(id)!));
        // Ưu tiên nhóm bắn được ngay; sau đó tới màu còn nhiều khối (kiểu gì cũng phải dùng).
        const nowFirable = pools.some((p) => (state.exposed.get(p.color)?.size ?? 0) > 0);
        const remain = pools.reduce((s, p) => s + (state.remaining.get(p.color) ?? 0), 0);
        if (nowFirable) firableFronts++;
        // Nhóm chiếm nhiều chỗ thì rút sau, để không tự bóp chết khoang chờ.
        const score = (nowFirable ? 1_000_000 : 0) + remain - group.length * 10;
        if (score > bestScore) {
          bestScore = score;
          bestGroup = group;
        }
      }
      if (fronts > 0) {
        freedomSum += firableFronts / fronts;
        freedomSamples++;
      }
      if (bestGroup) {
        // Đẩy con trỏ theo SỐ thành viên ở mỗi hàng (nhóm có thể có 2 khẩu cùng một hàng), và đọc
        // hết vị trí trước khi đẩy để vị trí không bị lệch giữa chừng.
        const advance = new Map<number, number>();
        const unit = unitSeq++;
        for (const id of bestGroup) {
          const at = pendingPosition(id)!;
          advance.set(at[0], (advance.get(at[0]) ?? 0) + 1);
          queue.push({ id, pools: poolsOf(byId.get(id)!), order: order++, unit });
        }
        for (const [column, count] of advance) cursor[column] += count;
        // Một lượt bấm = băng của mọi khẩu tan 1. Nhấc cả cặp nối nhau vẫn chỉ là MỘT lượt bấm.
        for (const [id, left] of ice) if (left > 0) ice.set(id, left - 1);
        // Chìa vừa lên khoang thì mở ổ. Data không nói chìa nào mở ổ nào (xem chú thích đầu file),
        // nên mở ổ đang chặn đầu hàng trước — đó là ổ duy nhất thực sự cản đường lúc này.
        for (const id of bestGroup) {
          if (byId.get(id)!.type !== BLASTER_TYPE_KEY || locked.size === 0) continue;
          locked.delete(pickLockToOpen());
        }
        picks++;
        const stalled = queue.filter((q) => !firablePool(q)).length;
        maxStalled = Math.max(maxStalled, stalled);
        if (stalled > 0) stalls++;
        continue;
      }
    }

    // 4. Không bắn được, không rút được -> tắc. Nếu còn súng ở hàng mà nghẽn vì nhóm nối nhau không
    // đủ chỗ thì nói rõ ra, vì cách sửa khác hẳn (tăng dockCount / bỏ nối) so với tắc vì màu.
    let groupNeeds = 0;
    const stuckGroups: SimOutput['stuckGroups'] = [];
    const frozenHeads: SimOutput['frozenHeads'] = [];
    const lockedHeads: number[] = [];
    let columnsWithBlasters = 0;
    for (let i = 0; i < columns.length; i++) {
      if (cursor[i] >= columns[i].length) continue;
      columnsWithBlasters++;
      const head = columns[i][cursor[i]];
      const frozen = ice.get(head) ?? 0;
      if (frozen > 0) frozenHeads.push({ id: head, left: frozen });
      if (locked.has(head)) lockedHeads.push(head);
      const group = groupOf.get(head) ?? [head];
      if (group.length > slots) groupNeeds = Math.max(groupNeeds, group.length);
      if (group.length <= 1 || pullableGroup(i, slots - queue.length)) continue;

      // Phân loại vì sao nhóm này không rút được — mỗi loại một cách sửa khác nhau.
      const positions = group.map((id) => pendingPosition(id));
      let why: SimOutput['stuckGroups'][number]['why'] = 'deep';
      if (group.length > slots) {
        why = 'slots';
      } else if (positions.some((p) => !p)) {
        why = 'unplaced';
      } else {
        const byColumn = new Map<number, number[]>();
        for (const at of positions) {
          const list = byColumn.get(at![0]);
          if (list) list.push(at![1]);
          else byColumn.set(at![0], [at![1]]);
        }
        // Nhiều thành viên trong cùng một hàng thì phải đứng liền nhau. Xét độ liền của riêng chúng
        // (không so với con trỏ hàng): đó mới là khuyết tật vĩnh viễn, chứ còn "chưa tới lượt" thì
        // hàng vơi thêm là xong.
        for (const indices of byColumn.values()) {
          if (indices.length < 2) continue;
          indices.sort((a, b) => a - b);
          for (let k = 1; k < indices.length; k++) {
            if (indices[k] !== indices[k - 1] + 1) why = 'gap';
          }
        }
      }
      stuckGroups.push({ ids: group, why });
    }
    return {
      won: false,
      state,
      picks,
      stalls,
      maxStalled: Math.max(maxStalled, queue.length),
      wastedBullets,
      deadlocked: queue.length > 0 || canPull(),
      groupNeedsSlots: groupNeeds,
      // Báo cáo đúng màu nó đang chờ (túi tới lượt), không phải cả hai màu.
      queueAtEnd: queue.map((q) => {
        const pool = activePool(q);
        return { id: q.id, colors: pool ? [pool.color] : [] };
      }),
      unpulled: columns.reduce((n, c, i) => n + (c.length - cursor[i]), 0),
      stuckGroups,
      frozenHeads,
      lockedHeads,
      keysLeft: columns.reduce((n, c, i) => n + c.slice(cursor[i]).filter((id) => byId.get(id)?.type === BLASTER_TYPE_KEY).length, 0),
      columnsWithBlasters,
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
    groupNeedsSlots: 0,
    queueAtEnd: [],
    unpulled: 0,
    stuckGroups: [],
    frozenHeads: [],
    lockedHeads: [],
    keysLeft: 0,
    columnsWithBlasters: 0,
    choiceFreedom: freedomSamples ? freedomSum / freedomSamples : 1,
  };
}

/** Cơ chế có trong data nhưng mô phỏng chưa xử — để nói rõ kết quả chỉ là gần đúng. */
function ignoredMechanics(blasters: BlasterEntry[]): string[] {
  const out: string[] = [];
  // Key/Lock đã mô phỏng; chỉ còn các loại khác là chưa.
  const modelled = new Set([BLASTER_TYPE_NORMAL, BLASTER_TYPE_KEY, BLASTER_TYPE_LOCK]);
  const types = [...new Set(blasters.filter((b) => !modelled.has(b.type)).map((b) => b.type))];
  if (types.length) {
    out.push(
      `súng loại ${types
        .map((t) => BLASTER_TYPES.find((x) => x.id === t)?.name ?? t)
        .join(', ')} (coi như súng thường)`,
    );
  }
  if (blasters.some((b) => b.isChained)) out.push('súng bị khoá xích (isChained)');
  if (blasters.some((b) => b.innerBlasterIds.length)) out.push('súng lồng trong (inner)');
  return out;
}

const colorName = (id: number) => gameColorById(id)?.name ?? `ColorType ${id}`;

/**
 * Nói cho ra NGUYÊN NHÂN, không phải chỉ liệt kê những gì còn sót.
 *
 * "Hết súng mà còn 532 khối" thì đúng nhưng vô dụng — người dựng level vẫn phải tự đi tìm xem tại
 * sao. Ở đây tách bạch mấy nguyên nhân khác hẳn nhau, vì cách sửa mỗi cái một khác:
 *  1. thiếu đạn ngay từ đầu  -> thêm đạn / thêm súng
 *  2. đạn đủ nhưng bị phí    -> súng hai màu bắn lẹm sang màu kia
 *  3. nhóm nối nhau quá to   -> tăng dockCount hoặc bỏ nối
 *  4. tắc hàng               -> đổi thứ tự súng trong hàng
 *  5. khối bị bọc kín        -> sửa hình khối (tường vây quanh)
 */
function explainFailure(
  input: SolveInput,
  sim: SimOutput,
  initialByColor: Map<number, number>,
): string {
  const left = [...sim.state.remaining.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const leftText = left
    .slice(0, 4)
    .map(([c, n]) => `${colorName(c)} ${n}`)
    .join(', ');
  const tail = `Còn ${sim.state.blocksLeft} khối (${leftText}${left.length > 4 ? '…' : ''}).`;

  // 1. Thiếu đạn: so tổng đạn cả màn với tổng khối, theo từng màu. Đây là lỗi tĩnh — thứ tự bấm kiểu
  // gì cũng không cứu được, nên phải báo trước mọi nguyên nhân khác.
  const bullets = bulletCountsByColor(input.blasters);
  const short = [...initialByColor.entries()]
    .map(([color, blocks]) => ({ color, blocks, have: bullets.get(color) ?? 0 }))
    .filter((r) => r.have < r.blocks);
  if (short.length) {
    const detail = short
      .map((r) => `${colorName(r.color)} thiếu ${r.blocks - r.have} (${r.have} đạn / ${r.blocks} khối)`)
      .join('; ');
    return `Thiếu đạn: ${detail}. Bấm kiểu gì cũng không đủ để phá hết — thêm đạn hoặc thêm súng cho các màu này.`;
  }

  // 2. Nhóm nối nhau to hơn cả khoang chờ.
  if (sim.groupNeedsSlots) {
    return (
      `Nhóm ${sim.groupNeedsSlots} súng nối nhau phải cùng lên khoang một lượt, mà khoang chỉ có ` +
      `${input.dockCount} ô — không bao giờ rút được. ${tail}`
    );
  }

  // 3. Băng khoá cứng: mọi đầu hàng còn súng đều đang đóng băng. Băng chỉ tan khi có khẩu được nhấc
  // lên, mà lúc này không nhấc được khẩu nào -> băng đứng yên vĩnh viễn.
  if (sim.frozenHeads.length && sim.frozenHeads.length === sim.columnsWithBlasters) {
    const detail = sim.frozenHeads.map((h) => `${h.id} còn ${h.left}`).join(', ');
    return (
      `Băng khoá cứng: đầu của mọi hàng còn súng đều đang đóng băng (${detail}), mà băng chỉ tan ` +
      `mỗi khi nhấc được một khẩu lên — không nhấc được khẩu nào thì băng không bao giờ tan. ` +
      `Giảm iceHp, hoặc chừa một hàng có khẩu đầu không băng. ${tail}`
    );
  }

  // 4. Ổ khoá chặn đầu hàng mà không còn chìa nào lấy được -> hàng đó chết hẳn.
  if (sim.lockedHeads.length) {
    return (
      `Ổ khoá ${sim.lockedHeads.join(', ')} đang chặn đầu hàng mà ` +
      `${sim.keysLeft ? `${sim.keysLeft} chìa còn lại đều nằm sau một ổ khác` : 'không còn chìa nào'} — ` +
      `hàng đó không mở ra được nữa. Thêm chìa, hoặc chuyển chìa lên trước ổ. ${tail}`
    );
  }

  // 5. Nhóm nối nhau chặn cứng đầu hàng: mọi khẩu phía sau nó thành vô dụng.
  const jam = sim.stuckGroups.find((g) => g.why === 'gap') ?? sim.stuckGroups.find((g) => g.why === 'unplaced');
  if (jam) {
    const ids = jam.ids.join('↔');
    const behind = sim.unpulled ? ` ${sim.unpulled} khẩu phía sau vì thế không dùng được.` : '';
    return jam.why === 'gap'
      ? `Cặp nối nhau ${ids} nằm cùng một hàng nhưng có khẩu khác chen giữa, nên không bao giờ rút ` +
          `lên cùng nhau được và hàng đó tắc từ đấy trở đi.${behind} Xếp hai khẩu sát nhau, hoặc ` +
          `chuyển một khẩu sang hàng khác. ${tail}`
      : `Nhóm nối nhau ${ids} có khẩu chưa được xếp vào hàng nào, nên cả nhóm không rút lên được ` +
          `và hàng đang bị nó chặn.${behind} ${tail}`;
  }

  // 4. Khối bị bọc kín: còn khối nhưng chẳng màu nào còn khối hở, tức không còn gì để bắn kể cả khi
  // có sẵn súng. Thường là bị tường (ColorType.None) vây quanh.
  const noExposed = left.every(([c]) => (sim.state.exposed.get(c)?.size ?? 0) === 0);
  if (left.length && noExposed) {
    return (
      `Số khối còn lại không bao giờ hở ra mặt nào để bắn — gần như chắc chắn bị khối tường vây ` +
      `kín. Sửa hình khối chứ không sửa được bằng súng. ${tail}`
    );
  }

  // 4. Tắc hàng: khoang còn súng nhưng không khẩu nào bắn được, và không rút thêm được ai.
  if (sim.queueAtEnd.length) {
    const waiting = sim.queueAtEnd
      .slice(0, 4)
      .map((q) => `${q.id} (chờ ${q.colors.map(colorName).join('/') || 'không còn màu nào'})`)
      .join(', ');
    return (
      `Tắc hàng: khoang chờ kín ${sim.queueAtEnd.length}/${input.dockCount} ô mà không khẩu nào có ` +
      `khối hở cùng màu để bắn — ${waiting}${sim.unpulled ? `, còn ${sim.unpulled} khẩu chưa rút được` : ''}. ` +
      `Đổi thứ tự súng trong hàng hoặc tăng dockCount. ${tail}`
    );
  }

  // 5. Đạn đủ trên giấy nhưng bị phí (súng hai màu bắn lẹm sang màu kia rồi rời khoang).
  if (sim.wastedBullets) {
    return (
      `Đủ đạn trên giấy nhưng ${sim.wastedBullets} viên bị bỏ phí: súng rời khoang khi màu của nó ` +
      `đã hết khối (hay gặp ở súng hai màu — nó bắn màu nào cũng được nên tiêu lẹm sang màu kia). ${tail}`
    );
  }

  // 6. Không rơi vào mẫu nào ở trên: nói thẳng là hết súng, kèm số liệu để còn lần ra.
  return (
    `Hết súng mà vẫn còn khối${sim.unpulled ? ` (${sim.unpulled} khẩu chưa rút được khỏi hàng)` : ''}. ${tail}`
  );
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
    hiddenCount: input.blasters.filter((b) => b.isHidden).length,
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
  return shape(sim, POLICIES.length, explainFailure(input, sim, base.remaining));
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
  /**
   * Giấu màu không làm màn khó GIẢI hơn (mô phỏng vẫn thắng y như cũ) mà làm khó CHƠI hơn: không
   * nhìn trước được thì không tính đường được. Trọng số ngang với số màu vì nó vô hiệu hoá đúng cái
   * thông tin mà người chơi dựa vào để chọn hàng.
   */
  hidden: 2,
  /**
   * Tường bịt hướng bắn, buộc người chơi xoay khối tìm góc khác — và khối bị nó che thì phải đào
   * vòng chứ không bắn thẳng được. Trọng số vừa phải: nó làm rối đường đi chứ không khoá cứng lượt
   * bấm như băng.
   */
  walls: 1,
  /**
   * Băng khoá cứng lượt bấm: khẩu bọc băng không bấm được cho tới khi băng tan, mà băng chỉ tan
   * khi có khẩu khác được nhấc lên. Ba yếu tố dưới đây là cơ chế ĐÃ mô phỏng được, nên chúng không
   * nằm trong `mechanics` (chỗ đó chỉ đếm cơ chế chưa mô phỏng). Không cho chúng trọng số riêng thì
   * một màn nhồi kín băng/khoá vẫn bị chấm ngang màn trống trơn — chúng chỉ hiện ra rất nhẹ qua số
   * lần chờ và độ bó lựa chọn.
   */
  ice: 1.5,
  /** Ổ khoá chặn luôn mọi khẩu xếp sau nó trong hàng — nặng ngang băng. */
  locks: 1.5,
  /** Súng nối nhau phải cùng lên khoang một lượt, tức ăn 2 ô khoang cùng lúc. */
  connected: 1,
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
  let wallCount = 0;
  for (const { voxel } of input.grid.entries()) {
    if (matchGameColor(voxel.color).color.id === WALL_COLOR_ID) wallCount++;
  }
  const mechanics = result.ignoredMechanics.length;

  // Số đo của các cơ chế đã mô phỏng — tính theo TỈ LỆ trên số khẩu, không phải số tuyệt đối:
  // 3 khẩu băng trong 6 khẩu là màn ngạt thở, trong 60 khẩu thì gần như không thấy.
  const gunCount = Math.max(1, input.blasters.length);
  const icedCount = input.blasters.filter((b) => b.iceHp > 0).length;
  const avgIce = icedCount
    ? input.blasters.reduce((s, b) => s + Math.max(0, b.iceHp), 0) / icedCount
    : 0;
  const lockCount = input.blasters.filter((b) => b.type === BLASTER_TYPE_LOCK).length;
  const keyCount = input.blasters.filter((b) => b.type === BLASTER_TYPE_KEY).length;
  const linkedCount = input.blasters.filter((b) => b.connectedBlasterIds.length > 0).length;

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
      key: 'walls',
      label: 'Tường che',
      // Lấy theo tỉ lệ tường trên tổng voxel: tường càng nhiều thì càng nhiều hướng bị bịt.
      value: clamp01(wallCount / Math.max(1, wallCount + result.totalBlocks) / 0.4),
      weight: WEIGHTS.walls,
      detail: wallCount
        ? `${wallCount} khối tường / ${wallCount + result.totalBlocks} voxel — bịt hướng bắn, phải xoay tìm góc`
        : 'không có',
    },
    {
      key: 'ice',
      label: 'Súng bọc băng',
      // 40% số khẩu bọc băng là kín thang: quá mức đó thì mô phỏng cũng khó tìm ra thứ tự bấm.
      value: clamp01(icedCount / gunCount / 0.4),
      weight: WEIGHTS.ice,
      detail: icedCount
        ? `${icedCount}/${gunCount} khẩu bọc băng, dày trung bình ${avgIce.toFixed(1)}`
        : 'không có',
    },
    {
      key: 'locks',
      label: 'Ổ khoá',
      // Ngưỡng thấp hơn băng: một ổ khoá chặn cả khúc hàng phía sau, 25% đã rất nặng.
      value: clamp01(lockCount / gunCount / 0.25),
      weight: WEIGHTS.locks,
      detail: lockCount
        ? `${lockCount} ổ khoá / ${keyCount} chìa trên ${gunCount} khẩu`
        : 'không có',
    },
    {
      key: 'connected',
      label: 'Súng nối nhau',
      value: clamp01(linkedCount / gunCount / 0.5),
      weight: WEIGHTS.connected,
      detail: linkedCount
        ? `${linkedCount}/${gunCount} khẩu bị buộc vào khẩu khác`
        : 'không có',
    },
    {
      key: 'hidden',
      label: 'Súng giấu màu',
      value: clamp01(input.blasters.length ? result.hiddenCount / input.blasters.length : 0),
      weight: WEIGHTS.hidden,
      detail: result.hiddenCount
        ? `${result.hiddenCount}/${input.blasters.length} khẩu giấu màu — người chơi không nhìn trước được`
        : 'không có',
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

  const label = result.winnable ? difficultyLabel(score) : 'Không giải được';

  return {
    score,
    label,
    suggestedDifficulty: levelDifficultyForScore(score),
    factors,
  };
}

/** Tên gọi của một mức điểm trên thang 0..10. */
export function difficultyLabel(score: number): string {
  return score < 2
    ? 'Rất dễ'
    : score < 4
      ? 'Dễ'
      : score < 6
        ? 'Vừa'
        : score < 8
          ? 'Khó'
          : 'Rất khó';
}

/**
 * Điểm 0..10 -> enum `LevelDifficulty` của game (0 Normal / 1 Hard / 2 VeryHard).
 *
 * Tách ra để chỗ tạo nhanh súng dùng đúng ngưỡng mà `rateDifficulty` đang chấm: hai chỗ
 * lệch ngưỡng thì tool tự chấm một màn khác với difficulty mà chính nó vừa đặt vào file.
 */
export function levelDifficultyForScore(score: number): number {
  return score < 4 ? 0 : score < 7 ? 1 : 2;
}
