// vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tanstack/react-table': resolve(
        __dirname,
        'src/vendor/tanstack/react-table.ts'
      ),
      '@tanstack/react-virtual': resolve(
        __dirname,
        'src/vendor/tanstack/react-virtual.ts'
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './setupTests.ts',
  },
});
