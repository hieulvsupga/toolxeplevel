/**
 * Ghi file .xlsx tối giản — không dùng thư viện ngoài.
 *
 * Viết tay thay vì kéo thêm một dependency vì .xlsx chỉ là một file ZIP chứa vài XML, và ở đây chỉ
 * cần đúng một sheet phẳng: chữ, số, hàng tiêu đề in đậm, khoá hàng tiêu đề, bật lọc/sắp xếp.
 *
 * Không chọn CSV vì Excel trên máy Việt Nam lấy `;` làm dấu phân cách danh sách — file CSV dùng dấu
 * phẩy mở ra sẽ dồn hết vào một cột, và số bị đọc thành chữ. .xlsx thì không có chuyện đó.
 */
import { deflateRawSync } from 'node:zlib';

export type CellValue = string | number;

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP không nén-nổi-thì-vẫn-deflate, một file phẳng, không cần zip64 với cỡ báo cáo này. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version cần để mở
    local.writeUInt16LE(0x0800, 6); // cờ: tên file là UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // thời gian/ngày: để 0 cho file sinh ra luôn giống nhau
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, deflated);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // offset của local header tương ứng
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Số cột -> chữ cột (1 -> A, 27 -> AA). */
function colName(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const XMLNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface SheetOptions {
  sheetName?: string;
  /** Bề rộng từng cột (đơn vị ký tự). Thiếu thì Excel tự co. */
  columnWidths?: number[];
}

/**
 * Dựng file .xlsx một sheet: hàng đầu là tiêu đề (in đậm, khoá lại khi cuộn, có nút lọc/sắp xếp),
 * các hàng sau là dữ liệu. Số ghi dạng số thật nên sắp xếp và lọc theo khoảng đều đúng.
 */
export function buildXlsx(
  header: string[],
  rows: CellValue[][],
  options: SheetOptions = {},
): Buffer {
  const sheetName = options.sheetName ?? 'Sheet1';
  const lastCol = colName(header.length);
  const lastRow = rows.length + 1;

  const cell = (col: number, row: number, value: CellValue, bold = false): string => {
    const ref = `${colName(col)}${row}`;
    const style = bold ? ' s="1"' : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"${style}><v>${value}</v></c>`;
    }
    return `<c r="${ref}"${style} t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`;
  };

  const cols = options.columnWidths?.length
    ? `<cols>${options.columnWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const body = [
    `<row r="1">${header.map((h, i) => cell(i + 1, 1, h, true)).join('')}</row>`,
    ...rows.map(
      (r, ri) => `<row r="${ri + 2}">${r.map((v, i) => cell(i + 1, ri + 2, v)).join('')}</row>`,
    ),
  ].join('');

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${XMLNS}">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    // Khoá hàng tiêu đề: bảng 1745 dòng mà cuộn xuống là mất tiêu đề thì không đọc nổi cột nào là cột nào.
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    cols +
    `<sheetData>${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    `</worksheet>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="${XMLNS}">` +
    `<fonts count="2"><font/><font><b/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
    `<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>` +
    `</styleSheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${XMLNS}" xmlns:r="${REL}">` +
    `<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const buf = (s: string) => Buffer.from(s, 'utf8');
  return zip([
    { name: '[Content_Types].xml', data: buf(contentTypes) },
    { name: '_rels/.rels', data: buf(rootRels) },
    { name: 'xl/workbook.xml', data: buf(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: buf(workbookRels) },
    { name: 'xl/styles.xml', data: buf(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: buf(sheet) },
  ]);
}
