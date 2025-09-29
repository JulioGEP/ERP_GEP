import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Siempre llamamos a '/api' desde el front. Vite lo proxya al backend local.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  preview: {
    port: 5173,
    strictPort: true
  }
});
