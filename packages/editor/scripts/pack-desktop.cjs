/**
 * Đóng gói app desktop thủ công: copy runtime Electron + app (dist + main) vào
 * 1 thư mục chạy được, không cần electron-builder (tránh lỗi symlink/ký tên trên
 * máy không có quyền admin).
 *
 * Chạy sau khi `npm run build`. Kết quả: release/<ProductName>/<ProductName>.exe
 */
const fs = require('node:fs');
const path = require('node:path');

const PRODUCT = 'Voxel Level Tool';
const EDITOR = path.join(__dirname, '..');
const ELECTRON_DIST = path.join(EDITOR, '..', '..', 'node_modules', 'electron', 'dist');
const OUT = path.join(EDITOR, 'release', PRODUCT);
const DIST = path.join(EDITOR, 'dist');

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!fs.existsSync(ELECTRON_DIST)) fail('Không thấy runtime Electron. Chạy `npm install` trước.');
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('Chưa có dist. Chạy `npm run build` trước.');

console.log('• Dọn thư mục ra…');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log('• Copy runtime Electron…');
fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });

// Đổi tên electron.exe thành tên sản phẩm.
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, PRODUCT + '.exe'));

// Bỏ app mặc định của Electron.
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });

console.log('• Copy app (dist + main)…');
const APP = path.join(OUT, 'resources', 'app');
fs.mkdirSync(APP, { recursive: true });
fs.cpSync(DIST, path.join(APP, 'dist'), { recursive: true });
fs.copyFileSync(path.join(EDITOR, 'electron-main.cjs'), path.join(APP, 'electron-main.cjs'));
fs.writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify({ name: 'voxel-level-tool', productName: PRODUCT, main: 'electron-main.cjs' }, null, 2),
);

console.log('\n✅ Xong! Thư mục app:');
console.log('   ' + OUT);
console.log('   Chạy: "' + PRODUCT + '.exe"  (nén cả thư mục này gửi cho người khác)');
