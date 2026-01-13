import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9090',
        changeOrigin: true,
        secure: false
      },
      '/init': {
        target: 'http://localhost:9090',
        changeOrigin: true,
        secure: false
      },
      '/login': {
        target: 'http://localhost:9090',
        changeOrigin: true,
        secure: false
      }
    }
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
    dir: './tests/unit'
  }
});
