/**
 * Dịch level của game tapaway sang LevelData (.asset) của tool này.
 *
 * Chạy: `npm run convert:tapaway`  (thêm số để chỉ dịch thử vài file: `npm run convert:tapaway -- 5`)
 * Vào:  levelgametapaway/levelbase/level_*.txt
 * Ra:   voxellevel/level_*.asset
 *
 * ---- Format của tapaway (đọc ra từ LevelManager.cs) ----
 * File text, các dòng cách nhau \n, bỏ dòng rỗng:
 *   dòng 0: `sz|sx|sy|<ô>|<ô>|…`  — CHÚ Ý thứ tự: số đầu là kích thước trục Z (chiều sâu),
 *           rồi X, rồi Y. Chính `Edittext()` cũng đảo lại: `statusLevel = (x: n[1], y: n[2], z: n[0])`.
 *   dòng 1: `rotX|rotY|rotZ|cameraDistance[|limitMove]` — cách tapaway trình bày khối, không mang sang.
 *   dòng 2: `style|style|…` — song song 1:1 với danh sách ô ở dòng 0 (đã kiểm: khớp ở cả 1745 file).
 *   dòng 3: dữ liệu khối ghép x2/x3, mỗi 6 số một cụm — chỉ 13/1745 file có, và nó chỉ GỘP các khối
 *           đã có sẵn ở dòng 0 thành khối dài, không thêm ô mới. Nên bỏ qua được: hình khối vẫn đủ.
 *
 * Thứ tự ô là y-major → x → z (z trong cùng), đúng theo ba vòng lặp của `CreateMap()`:
 *   `for i<sy { for j<sx { for g<sz { arraydata[flag++] } } }`, và ô đó nằm ở world (j, i, g).
 *
 * Giá trị ô: `>0` là khối (số = HƯỚNG trượt ra, 1..6 — game mình không có cơ chế này nên bỏ),
 * `-2` tường, `-3` grinder, `-1` trống.
 *
 * ---- Quy đổi ----
 * Trục: tapaway là Unity (Y lên, Z vào trong màn hình), tool này Z lên. Nên:
 *   our.x = j            (giữ nguyên trái–phải)
 *   our.y = sz - 1 - g   (chiều sâu, ĐẢO — xem ghi chú handedness bên dưới)
 *   our.z = i            (chiều cao)
 * Phải đảo một trục vì phép đổi cơ sở (X,Y,Z) -> (X,Z,Y) làm lật chirality: không đảo thì khối ra
 * ảnh gương của bản gốc. Đảo chiều SÂU chứ không đảo trái–phải, để nhìn từ mặt trước (hướng camera
 * mặc định của tool) thì hình giống hệt tapaway.
 *
 * Màu: `styleColor` của tapaway là số nhóm 1..15 (đo trên toàn bộ data), mà `ColorType` của game mình
 * cũng là số nhóm 1..16 — nên map thẳng số sang số. Tường `-2` sang đúng ô tường (ColorType 0). Grinder
 * `-3` không có tương đương nên cũng thành tường (nó cũng là vật cản), và script đếm riêng để báo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GAME_COLORS,
  VoxelGrid,
  WALL_HEX,
  autoShooters,
  blockCountsByColor,
  buildLayers,
  DEFAULT_LEVEL_META,
  gameColorById,
  toUnityAsset,
} from '../packages/core/src/index';

const IN_DIR = path.join(__dirname, '..', 'levelgametapaway', 'levelbase');
const OUT_DIR = path.join(__dirname, '..', 'voxellevel');

/** Số hàng chờ + số đạn mỗi khẩu cho bộ súng cơ bản kèm theo mỗi file. */
const ROW_COUNT = 5;
const BULLETS_PER_BLASTER = 40;

/** ColorType lớn nhất dùng được (0 là tường). */
const MAX_COLOR_ID = Math.max(...GAME_COLORS.map((c) => c.id));

interface Parsed {
  /** Kích thước theo trục của tapaway. */
  sx: number;
  sy: number;
  sz: number;
  cells: number[];
  styles: number[] | null;
}

function parseLevel(text: string): Parsed | null {
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (!lines.length) return null;
  const head = lines[0].split('|').map(Number);
  if (head.length < 4 || head.slice(0, 3).some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const [sz, sx, sy] = head;
  const cells = head.slice(3);
  if (cells.length !== sx * sy * sz) return null;
  const styles = lines[2] ? lines[2].split('|').map(Number) : null;
  return { sx, sy, sz, cells, styles: styles && styles.length === cells.length ? styles : null };
}

/** `styleColor` của tapaway -> hex của `ColorType` tương ứng trong game mình. */
function hexForStyle(style: number | undefined): string {
  const id = !style || !Number.isFinite(style) ? 1 : ((style - 1) % MAX_COLOR_ID) + 1;
  return gameColorById(id)?.hex ?? GAME_COLORS[1].hex;
}

interface Stats {
  blocks: number;
  walls: number;
  grinders: number;
  colors: number;
}

function gridFromParsed(p: Parsed): { grid: VoxelGrid; stats: Stats } {
  const grid = new VoxelGrid();
  const stats: Stats = { blocks: 0, walls: 0, grinders: 0, colors: 0 };
  const used = new Set<string>();
  const plane = p.sx * p.sz;

  for (let flag = 0; flag < p.cells.length; flag++) {
    const value = p.cells[flag];
    if (value !== -2 && value !== -3 && value <= 0) continue;

    // Giải ngược thứ tự y-major -> x -> z của CreateMap().
    const i = Math.floor(flag / plane); // y (chiều cao)
    const rest = flag % plane;
    const j = Math.floor(rest / p.sz); // x
    const g = rest % p.sz; // z (chiều sâu)

    const x = j;
    const y = p.sz - 1 - g;
    const z = i;

    if (value === -2 || value === -3) {
      grid.set(x, y, z, { color: WALL_HEX });
      if (value === -2) stats.walls++;
      else stats.grinders++;
      continue;
    }
    const hex = hexForStyle(p.styles?.[flag]);
    grid.set(x, y, z, { color: hex });
    used.add(hex);
    stats.blocks++;
  }
  stats.colors = used.size;
  return { grid, stats };
}

function convert(file: string): { name: string; stats: Stats; size: string } | null {
  const parsed = parseLevel(fs.readFileSync(path.join(IN_DIR, file), 'utf8'));
  if (!parsed) return null;
  const { grid, stats } = gridFromParsed(parsed);
  if (!grid.size) return null;

  const name = path.basename(file, '.txt');
  const built = buildLayers(grid, { recenter: true });
  // Bộ súng cơ bản: chia đều theo số khối từng màu nên tổng đạn KHỚP số khối (điều kiện thắng của
  // game). Chỉ để file là data hợp lệ ngay — muốn có cơ chế và mức khó thì mở tool bấm ⚡ tạo lại.
  const shooters = autoShooters(blockCountsByColor(grid), {
    rowCount: ROW_COUNT,
    bulletsPerBlaster: BULLETS_PER_BLASTER,
  });
  const meta = { ...DEFAULT_LEVEL_META, name };
  fs.writeFileSync(
    path.join(OUT_DIR, `${name}.asset`),
    toUnityAsset(built.layers, meta, shooters),
    'utf8',
  );

  const b = built.bounds;
  const size = b
    ? `${b.max.x - b.min.x + 1}×${b.max.y - b.min.y + 1}×${b.max.z - b.min.z + 1}`
    : '—';
  return { name, stats, size };
}

function main(): void {
  const limit = Number(process.argv[2]) || Infinity;
  if (!fs.existsSync(IN_DIR)) {
    console.error(`Không thấy thư mục vào: ${IN_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = fs
    .readdirSync(IN_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0))
    .slice(0, limit === Infinity ? undefined : limit);

  let ok = 0;
  let skipped = 0;
  let blocks = 0;
  let walls = 0;
  let grinders = 0;
  const multiColor: string[] = [];
  const withGrinder: string[] = [];

  for (const file of files) {
    const result = convert(file);
    if (!result) {
      skipped++;
      console.warn(`  bỏ qua ${file} — không đọc được hoặc không có khối nào`);
      continue;
    }
    ok++;
    blocks += result.stats.blocks;
    walls += result.stats.walls;
    grinders += result.stats.grinders;
    if (result.stats.colors > 1) multiColor.push(result.name);
    if (result.stats.grinders) withGrinder.push(result.name);
    if (ok <= 5 || ok % 250 === 0) {
      console.log(
        `  ${result.name}: ${result.size} · ${result.stats.blocks} khối · ${result.stats.colors} màu` +
          (result.stats.walls ? ` · ${result.stats.walls} tường` : '') +
          (result.stats.grinders ? ` · ${result.stats.grinders} grinder→tường` : ''),
      );
    }
  }

  console.log(`\nXong: ${ok} file ra ${OUT_DIR}${skipped ? `, bỏ qua ${skipped}` : ''}`);
  console.log(`Tổng: ${blocks} khối, ${walls} tường, ${grinders} grinder (đã chuyển thành tường)`);
  console.log(`Level nhiều hơn 1 màu: ${multiColor.length}`);
  if (withGrinder.length) {
    console.log(`Level có grinder: ${withGrinder.join(', ')}`);
  }
}

main();
