import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Luôn full-reload thay vì HMR: tránh tình trạng store zustand / listener bị
 * desync khi hot-reload (đã gây khối đen, drag lỗi... trong quá trình dev).
 */
function fullReloadAlways(): Plugin {
  return {
    name: 'full-reload-always',
    handleHotUpdate({ server }) {
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default defineConfig({
  plugins: [react(), fullReloadAlways()],
  resolve: {
    alias: {
      '@voxel/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
