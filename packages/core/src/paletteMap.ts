import {
  GAME_COLORS,
  WALL_COLOR_ID,
  labDistance2,
  labOf,
  matchGameColor,
  type GameColor,
} from './gameColors';

/**
 * Gán màu nguồn (texture, vật liệu model, ảnh) sang bảng màu 16 màu của game sao cho các màu KHÁC
 * NHAU vẫn ra khác nhau.
 *
 * Chỗ hụt của cách dò từng màu một (`matchGameColor`): hai màu nguồn A, B mắt thấy khác nhau nhưng
 * cùng gần một màu game C thì cả hai đều thành C — hình mất chi tiết, mà bảng màu game thì vẫn còn
 * màu chưa ai dùng. Ở đây gán theo CẢ BỘ: mỗi nhóm màu nguồn chiếm một màu game riêng, cặp nào
 * giống nhau nhất được chốt trước, nhóm đến sau lấy màu TRỐNG gần nó nhất.
 */

/** Ô tường không phải màu — không bao giờ gán một màu nguồn vào đó (xem `matchGameColor`). */
const TARGETS = GAME_COLORS.filter((c) => c.id !== WALL_COLOR_ID);

export const MAX_MAPPED_COLORS = TARGETS.length;

export interface SourceColor {
  hex: string;
  /** Số voxel mang màu này — nhóm nhiều voxel được ưu tiên giữ đúng màu hơn. */
  count: number;
}

export interface MappedColorGroup {
  /** Hex nguồn tiêu biểu của nhóm (màu có nhiều voxel nhất trong nhóm). */
  source: string;
  /** Mọi hex nguồn bị gộp vào nhóm này. */
  sources: string[];
  count: number;
  target: GameColor;
  /** Khoảng cách Lab từ màu tiêu biểu tới màu game được gán — càng lớn là màu bị đổi càng nhiều. */
  distance: number;
  /** true = nhóm KHÔNG lấy được màu game gần nó nhất vì nhóm khác đã chiếm. */
  moved: boolean;
}

export interface PaletteMapResult {
  /** hex nguồn (CHỮ HOA) -> hex màu game. */
  map: Map<string, string>;
  /** Các nhóm, nhiều voxel trước. */
  groups: MappedColorGroup[];
  /** Màu game chưa nhóm nào dùng — chỗ còn để tách thêm màu. */
  free: GameColor[];
}

export interface PaletteMapOptions {
  /**
   * Số màu game tối đa được dùng. Nhiều màu nguồn hơn thế thì GOM CỤM lại (k-means trong Lab), chứ
   * không cắt bớt — cắt là mất hẳn một phần hình.
   */
  maxColors?: number;
  /**
   * false = mỗi màu nguồn cứ lấy màu game gần nhất, cho phép nhiều màu nguồn về cùng một màu game
   * (đúng cách `matchGameColor` làm). Giữ để so sánh với nếp cũ.
   */
  distinct?: boolean;
  /**
   * Hai màu nguồn cách nhau dưới mức này (đơn vị Lab, ~ΔE) thì coi là MỘT màu và gộp lại trước khi
   * gán. Mặc định `DEFAULT_MERGE_BELOW`.
   *
   * Không có bước này thì việc tách màu thành ra phản tác dụng: texture nén (jpg) hay có mấy hex
   * lệch nhau 1–2 độ mắt không phân biệt được, mà mỗi cái lại bị đẩy sang một màu game khác hẳn —
   * hình rằn ri hơn cả lúc bị gộp.
   */
  mergeBelow?: number;
  /** Ép nhóm về màu game chỉ định: hex tiêu biểu của nhóm -> `ColorType`. */
  overrides?: Record<string, number>;
}

const upper = (hex: string) => hex.toUpperCase();

interface Cluster {
  lab: [number, number, number];
  sources: string[];
  count: number;
  /** Hex nhiều voxel nhất trong cụm — làm màu tiêu biểu khi hiện ra cho người dùng. */
  source: string;
}

/**
 * Ngưỡng "coi như cùng một màu", đơn vị Lab. ΔE 2.3 là mức mắt vừa phân biệt được ở điều kiện lý
 * tưởng; lấy 8 để chịu được nhiễu của texture nén và ánh sáng nướng sẵn trong ảnh, mà vẫn tách được
 * các sắc độ người vẽ cố ý làm khác nhau.
 */
export const DEFAULT_MERGE_BELOW = 8;

/**
 * Gộp các màu nguồn na ná nhau thành một cụm (gộp theo màu dẫn đầu: đi từ màu nhiều voxel nhất,
 * màu sau nhập vào cụm nào có màu tiêu biểu nằm trong `mergeBelow`).
 *
 * Chọn cách này thay vì gom cụm đầy đủ vì nó xác định và dễ giải thích: cụm luôn mang tên màu đông
 * nhất, và thêm một màu lẻ vào texture không xáo lại toàn bộ cách gán.
 */
function mergeNearby(sources: SourceColor[], mergeBelow: number): Cluster[] {
  const limit = Math.max(0, mergeBelow) ** 2;
  const clusters: Cluster[] = [];
  for (const s of sources) {
    const lab = labOf(s.hex);
    let host: Cluster | undefined;
    let hostD = Infinity;
    for (const c of clusters) {
      const d = labDistance2(labOf(c.source), lab);
      if (d <= limit && d < hostD) {
        hostD = d;
        host = c;
      }
    }
    if (host) {
      host.sources.push(s.hex);
      host.count += s.count;
      continue;
    }
    clusters.push({ lab, sources: [s.hex], count: s.count, source: s.hex });
  }
  // Tâm cụm = trung bình có trọng số của các màu trong cụm, để so với bảng màu game cho đúng chỗ
  // đứng thật của cụm chứ không chỉ theo màu dẫn đầu.
  for (const c of clusters) {
    if (c.sources.length === 1) continue;
    const total = c.sources.reduce(
      (acc, hex) => {
        const w = sources.find((s) => s.hex === hex)?.count ?? 0;
        const lab = labOf(hex);
        acc[0] += lab[0] * w;
        acc[1] += lab[1] * w;
        acc[2] += lab[2] * w;
        acc[3] += w;
        return acc;
      },
      [0, 0, 0, 0],
    );
    if (total[3]) c.lab = [total[0] / total[3], total[1] / total[3], total[2] / total[3]];
  }
  return clusters;
}

/**
 * Gom màu nguồn về đúng `k` cụm bằng k-means có trọng số, đo trong Lab.
 *
 * Hạt giống lấy từ các màu nhiều voxel nhất nhưng phải cách nhau tối thiểu `MIN_SEED_SEP`: lấy
 * thẳng k màu đông nhất thì với texture có vùng nền lớn, cả k hạt đều rơi vào mấy sắc độ của nền,
 * còn chi tiết nhỏ mà khác màu hẳn thì không được cụm nào.
 *
 * Không dùng ngẫu nhiên ở bất cứ đâu: cùng model + texture phải luôn ra cùng cách gán màu, không
 * thì mỗi lần đổi độ phân giải lại thấy màu nhảy.
 */
function kmeansLab(sources: SourceColor[], k: number): Cluster[] {
  const MIN_SEED_SEP = 15 ** 2; // ~15 đơn vị Lab, quanh mức mắt thấy rõ là hai màu khác nhau
  const MAX_ITER = 24;

  const pts = sources
    .map((s) => ({ hex: s.hex, count: s.count, lab: labOf(s.hex) }))
    .sort((a, b) => b.count - a.count);

  const seeds: [number, number, number][] = [];
  for (const p of pts) {
    if (seeds.length >= k) break;
    if (seeds.every((s) => labDistance2(s, p.lab) >= MIN_SEED_SEP)) seeds.push([...p.lab]);
  }
  // Chưa đủ hạt (ít màu, hoặc các màu nằm sát nhau) -> bù bằng màu đông nhất còn lại.
  for (const p of pts) {
    if (seeds.length >= k) break;
    if (!seeds.some((s) => labDistance2(s, p.lab) === 0)) seeds.push([...p.lab]);
  }

  let assign: number[] = new Array(pts.length).fill(-1);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const next = pts.map((p) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const d = labDistance2(seeds[i], p.lab);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    });
    const changed = next.some((v, i) => v !== assign[i]);
    assign = next;
    if (!changed) break;

    // Tâm mới = trung bình có trọng số theo số voxel. Cụm rỗng thì giữ tâm cũ (không bốc lại hạt:
    // bốc lại là kết quả phụ thuộc thứ tự lặp, sau này có gì lạ rất khó lần lại).
    const sum = seeds.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const s = sum[assign[i]];
      s[0] += pts[i].lab[0] * pts[i].count;
      s[1] += pts[i].lab[1] * pts[i].count;
      s[2] += pts[i].lab[2] * pts[i].count;
      s[3] += pts[i].count;
    }
    for (let i = 0; i < seeds.length; i++) {
      if (!sum[i][3]) continue;
      seeds[i] = [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]];
    }
  }

  const clusters: Cluster[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const members = pts.filter((_, j) => assign[j] === i);
    if (!members.length) continue;
    clusters.push({
      lab: seeds[i],
      sources: members.map((m) => m.hex),
      count: members.reduce((n, m) => n + m.count, 0),
      source: members[0].hex, // pts đã sắp theo count giảm dần
    });
  }
  return clusters;
}

/**
 * Gán mỗi cụm một màu game RIÊNG: xét mọi cặp (cụm, màu game) theo khoảng cách Lab tăng dần, cặp
 * nào cả hai bên còn trống thì chốt.
 *
 * Chốt theo cặp giống nhau nhất trước (không phải "cụm to nhất chọn trước") vì màu nguồn trùng khít
 * một màu game có khoảng cách 0 — nó luôn được chốt sớm nhất, không bị một cụm to hơn nhưng lệch
 * màu giành mất.
 */
function assignDistinct(clusters: Cluster[]): Map<number, GameColor> {
  const pairs: { ci: number; ti: number; d: number; count: number }[] = [];
  for (let ci = 0; ci < clusters.length; ci++) {
    for (let ti = 0; ti < TARGETS.length; ti++) {
      pairs.push({
        ci,
        ti,
        d: labDistance2(clusters[ci].lab, labOf(TARGETS[ti].hex)),
        count: clusters[ci].count,
      });
    }
  }
  // Cùng khoảng cách thì cụm nhiều voxel hơn chốt trước — để kết quả không phụ thuộc thứ tự đẩy vào.
  pairs.sort((a, b) => a.d - b.d || b.count - a.count);

  const out = new Map<number, GameColor>();
  const usedTarget = new Set<number>();
  for (const p of pairs) {
    if (out.size >= clusters.length) break;
    if (out.has(p.ci) || usedTarget.has(p.ti)) continue;
    out.set(p.ci, TARGETS[p.ti]);
    usedTarget.add(p.ti);
  }
  return out;
}

/** Ánh xạ bộ màu nguồn sang bảng màu game. Xem chú thích đầu file cho lý do gán theo cả bộ. */
export function mapColorsToGamePalette(
  sources: SourceColor[],
  options: PaletteMapOptions = {},
): PaletteMapResult {
  // Gộp hex trùng (khác nhau ở chữ hoa/thường) trước mọi phép đo.
  const merged = new Map<string, number>();
  for (const s of sources) {
    if (!s.count) continue;
    const key = upper(s.hex);
    merged.set(key, (merged.get(key) ?? 0) + s.count);
  }
  const list: SourceColor[] = [...merged.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count || (a.hex < b.hex ? -1 : 1));

  const map = new Map<string, string>();
  if (!list.length) return { map, groups: [], free: TARGETS };

  // Nếp cũ: từng màu tự dò màu gần nhất, chấp nhận gộp.
  if (options.distinct === false) {
    const byTarget = new Map<number, MappedColorGroup>();
    for (const s of list) {
      const target = matchGameColor(s.hex).color;
      map.set(s.hex, target.hex);
      const g = byTarget.get(target.id);
      if (g) {
        g.sources.push(s.hex);
        g.count += s.count;
      } else {
        byTarget.set(target.id, {
          source: s.hex,
          sources: [s.hex],
          count: s.count,
          target,
          distance: Math.sqrt(labDistance2(labOf(s.hex), labOf(target.hex))),
          moved: false,
        });
      }
    }
    const groups = [...byTarget.values()].sort((a, b) => b.count - a.count);
    const used = new Set(groups.map((g) => g.target.id));
    return { map, groups, free: TARGETS.filter((t) => !used.has(t.id)) };
  }

  const limit = Math.max(1, Math.min(options.maxColors ?? MAX_MAPPED_COLORS, MAX_MAPPED_COLORS));
  // Gộp màu na ná trước; còn nhiều nhóm hơn số màu cho phép thì mới gom cụm hẳn (k-means).
  const nearby = mergeNearby(list, options.mergeBelow ?? DEFAULT_MERGE_BELOW);
  const clusters = nearby.length <= limit ? nearby : kmeansLab(list, limit);
  const assigned = assignDistinct(clusters);

  const groups: MappedColorGroup[] = clusters.map((c, ci) => {
    const nearest = matchGameColor(c.source).color;
    const target = assigned.get(ci) ?? nearest;
    return {
      source: c.source,
      sources: c.sources,
      count: c.count,
      target,
      distance: Math.sqrt(labDistance2(labOf(c.source), labOf(target.hex))),
      moved: target.id !== nearest.id,
    };
  });

  // Ép tay: ĐỔI CHỖ với nhóm đang giữ màu đó, chứ không để hai nhóm dùng chung một màu — dùng chung
  // là mất đúng thứ cả hàm này để giữ.
  const overrides = options.overrides ?? {};
  for (const [sourceHex, colorId] of Object.entries(overrides)) {
    const mine = groups.find((g) => g.source === upper(sourceHex));
    const want = TARGETS.find((t) => t.id === colorId);
    if (!mine || !want || mine.target.id === want.id) continue;
    const other = groups.find((g) => g.target.id === want.id);
    if (other) other.target = mine.target;
    mine.target = want;
    for (const g of other ? [mine, other] : [mine]) {
      g.distance = Math.sqrt(labDistance2(labOf(g.source), labOf(g.target.hex)));
      g.moved = g.target.id !== matchGameColor(g.source).color.id;
    }
  }

  groups.sort((a, b) => b.count - a.count);
  for (const g of groups) for (const hex of g.sources) map.set(hex, g.target.hex);
  const used = new Set(groups.map((g) => g.target.id));
  return { map, groups, free: TARGETS.filter((t) => !used.has(t.id)) };
}

/** Đếm số voxel theo màu — dựng đầu vào cho `mapColorsToGamePalette`. */
export function countColors(items: { color: string }[]): SourceColor[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = upper(it.color);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([hex, count]) => ({ hex, count }));
}
