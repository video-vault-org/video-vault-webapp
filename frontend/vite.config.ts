import { defineConfig } from 'vitest/config';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3210';

const config = defineConfig({
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString()) },
  build: {
    rollupOptions: {
      input: { app: resolve(import.meta.dirname, 'index.html'), sw: resolve(import.meta.dirname, 'src/sw.ts') },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') }
    }
  },
  server: {
    proxy: {
      '/videovault-logo.png': backendUrl,
      '/api': backendUrl,
      '/login': backendUrl,
      '/bootstrap': backendUrl
    }
  },
  plugins: [
    {
      name: 'offline-assets',

      async closeBundle() {
        const root = resolve(import.meta.dirname, 'dist');

        const files = async function (path: string): Promise<string[]> {
          const entries = await readdir(resolve(root, path), { withFileTypes: true });
          return (
            await Promise.all(
              entries.map((e) => (e.isDirectory() ? files(`${path}${e.name}/`) : [`/${path}${e.name}`]))
            )
          ).flat();
        };

        await writeFile(
          resolve(root, 'videovault-logo.png'),
          await readFile(resolve(import.meta.dirname, '../img/default.logo.png'))
        );
        await writeFile(resolve(root, '.sw.template.js'), await readFile(resolve(root, 'sw.js')));
        await writeFile(
          resolve(root, 'precache.json'),
          JSON.stringify((await files('')).filter((p) => p !== '/precache.json' && p !== '/.sw.template.js'))
        );
      }
    }
  ],
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['src/tests/setup.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'forks',
    maxWorkers: 2
  }
});

export default config;
