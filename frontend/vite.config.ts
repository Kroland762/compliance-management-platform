import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const MAX_CHUNK_BYTES = 700 * 1024;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'enforce-production-chunk-budget',
      apply: 'build',
      generateBundle(_options, bundle) {
        const oversized = Object.values(bundle)
          .filter((item): item is Extract<typeof item, { type: 'chunk' }> => item.type === 'chunk')
          .filter((chunk) => Buffer.byteLength(chunk.code) > MAX_CHUNK_BYTES)
          .map((chunk) => `${chunk.fileName} (${Math.ceil(Buffer.byteLength(chunk.code) / 1024)} KiB)`);
        if (oversized.length) {
          this.error(`Production chunk budget exceeded (700 KiB): ${oversized.join(', ')}`);
        }
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|react-router-dom|zustand)\//.test(id)) return 'react-vendor';
          if (id.includes('node_modules/recharts/')) return 'charts';
          if (id.includes('node_modules/@ant-design/icons/')) return 'icons';
          if (/node_modules\/(axios|dayjs)\//.test(id)) return 'http';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
