/**
 * Electron main process — đóng gói editor thành app desktop.
 *
 * Phục vụ thư mục `dist` (bản build của Vite) qua một static server nội bộ ở
 * 127.0.0.1 rồi mở bằng cửa sổ Electron. Làm vậy để trình duyệt nạp ES module
 * bình thường (mở trực tiếp file:// sẽ bị chặn CORS).
 */
const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname = '/index.html';
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      } catch {
        /* dùng mặc định */
      }
      if (pathname === '/') pathname = '/index.html';
      // Chặn path traversal.
      const filePath = path.normalize(path.join(DIST, pathname));
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          // Fallback về index.html (SPA).
          fs.readFile(path.join(DIST, 'index.html'), (e2, d2) => {
            res.writeHead(e2 ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(d2 || 'Not found');
          });
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: '#1a1a1f',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Mở link ngoài (nếu có) bằng trình duyệt hệ thống.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
