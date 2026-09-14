/**
 * Lập bảng .xlsx liệt kê các level trong `voxellevel/` để người dựng map chọn hình khối.
 *
 * Chạy: `npm run report:levels`   (sau khi đã có `voxellevel/` — xem `npm run convert:tapaway`)
 * Ra:   voxellevel/danh-sach-level.xlsx
 *
 * Đọc thẳng từ file `.asset` đã sinh (qua đúng `parseUnityAsset` mà tool dùng khi nhập file), chứ
 * không đọc lại data gốc của tapaway: bảng phải mô tả đúng thứ người dựng sẽ mở ra.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WALL_COLOR_ID, parseUnityAsset } from '../packages/core/src/index';
import { buildXlsx, type CellValue } from './miniXlsx';

const DIR = path.join(__dirname, '..', 'voxellevel');
const OUT = path.join(DIR, 'danh-sach-level.xlsx');

interface Row {
  stt: number;
  name: string;
  blocks: number;
  walls: number;
  colors: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  layers: number;
  depthLayers: number;
  exposed: number;
  buried: number;
}

function statsOf(file: string): Row | null {
  const parsed = parseUnityAsset(fs.readFileSync(path.join(DIR, file), 'utf8'));
  if (!parsed.layers.length) return null;

  const name = path.basename(file, '.asset');
  const colors = new Set<number>();
  let blocks = 0;
  let walls = 0;
  let exposed = 0;
  let maxDepth = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const layer of parsed.layers) {
    const wall = layer.colorType === WALL_COLOR_ID;
    const n = layer.voxelPositions.length;
    if (wall) walls += n;
    else {
      blocks += n;
      colors.add(layer.colorType);
      // depth 0 = lớp vỏ, tức khối bắn được ngay từ đầu. Tường không tính vì không bao giờ là mục tiêu.
      if (layer.depth === 0) exposed += n;
    }
    if (layer.depth > maxDepth) maxDepth = layer.depth;
    for (const p of layer.voxelPositions) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }

  return {
    stt: parseInt(name.replace(/\D/g, ''), 10) || 0,
    name,
    blocks,
    walls,
    colors: colors.size,
    sizeX: maxX - minX + 1,
    sizeY: maxY - minY + 1,
    sizeZ: maxZ - minZ + 1,
    layers: parsed.layers.length,
    depthLayers: maxDepth + 1,
    exposed,
    buried: blocks - exposed,
  };
}

const HEADER = [
  'STT',
  'Level',
  'Số khối',
  'Số tường',
  'Số màu',
  'Rộng (X)',
  'Sâu (Y)',
  'Cao (Z)',
  'Số layer',
  'Số lớp depth',
  'Khối hở sẵn',
  'Khối bị chôn',
  '% bị chôn',
];

const WIDTHS = [6, 12, 9, 10, 8, 9, 8, 8, 10, 13, 12, 13, 10];

function main(): void {
  if (!fs.existsSync(DIR)) {
    console.error(`Không thấy ${DIR}. Chạy \`npm run convert:tapaway\` trước.`);
    process.exit(1);
  }
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.asset'));
  if (!files.length) {
    console.error(`Không có file .asset nào trong ${DIR}.`);
    process.exit(1);
  }

  const rows: Row[] = [];
  let skipped = 0;
  for (const file of files) {
    try {
      const row = statsOf(file);
      if (row) rows.push(row);
      else skipped++;
    } catch (err) {
      skipped++;
      console.warn(`  bỏ qua ${file}: ${(err as Error).message}`);
    }
  }
  rows.sort((a, b) => a.stt - b.stt || a.name.localeCompare(b.name));

  const table: CellValue[][] = rows.map((r) => [
    r.stt,
    r.name,
    r.blocks,
    r.walls,
    r.colors,
    r.sizeX,
    r.sizeY,
    r.sizeZ,
    r.layers,
    r.depthLayers,
    r.exposed,
    r.buried,
    r.blocks ? Math.round((r.buried / r.blocks) * 100) : 0,
  ]);

  fs.writeFileSync(OUT, buildXlsx(HEADER, table, { sheetName: 'Level', columnWidths: WIDTHS }));

  const nums = (pick: (r: Row) => number) => {
    const list = rows.map(pick).sort((a, b) => a - b);
    return `nhỏ nhất ${list[0]}, trung vị ${list[Math.floor(list.length / 2)]}, lớn nhất ${list[list.length - 1]}`;
  };
  console.log(`Xong: ${rows.length} level -> ${OUT}${skipped ? ` (bỏ qua ${skipped})` : ''}`);
  console.log(`  Số khối: ${nums((r) => r.blocks)}`);
  console.log(`  Số lớp depth: ${nums((r) => r.depthLayers)}`);
  console.log(`  Số màu: ${nums((r) => r.colors)}`);
  console.log(`  Level có tường: ${rows.filter((r) => r.walls > 0).length}`);
}

main();
