import { defineConfig } from 'vitest/config';
import { build } from 'vite';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3210';

const buildId = JSON.stringify(Date.now().toString());

const config = defineConfig({
  define: { __BUILD_ID__: buildId },
  build: {
    rollupOptions: {
      input: { app: resolve(import.meta.dirname, 'index.html') },
      output: { entryFileNames: 'assets/[name]-[hash].js' }
    }
  },
  server: {
    proxy: {
      '/videovault-logo.png': backendUrl,
      '/SECURITY-ARCHITECTURE.html': backendUrl,
      '/api': backendUrl,
      '/login': backendUrl,
      '/bootstrap': backendUrl
    }
  },
  plugins: [
    {
      name: 'offline-assets',
      apply: 'build',

      async closeBundle() {
        const root = resolve(import.meta.dirname, 'dist');
        // A self-contained classic worker also runs in Firefox versions without module-worker support.
        await build({
          configFile: false,
          root: import.meta.dirname,
          publicDir: false,
          define: { __BUILD_ID__: buildId },
          build: {
            outDir: root,
            emptyOutDir: false,
            target: 'es2020',
            lib: {
              entry: resolve(import.meta.dirname, 'src/sw.ts'),
              name: 'VideoVaultServiceWorker',
              formats: ['iife'],
              fileName: () => 'sw.js'
            },
            rollupOptions: { output: { inlineDynamicImports: true } }
          }
        });

        const files = async function (path: string): Promise<string[]> {
          const entries = await readdir(resolve(root, path), { withFileTypes: true });
          return (await Promise.all(entries.map((e) => (e.isDirectory() ? files(`${path}${e.name}/`) : [`/${path}${e.name}`])))).flat();
        };

        await writeFile(resolve(root, 'videovault-logo.png'), await readFile(resolve(import.meta.dirname, '../img/default.logo.png')));
        await writeFile(resolve(root, '.sw.template.js'), await readFile(resolve(root, 'sw.js')));
        await copyFile(resolve(import.meta.dirname, '../SECURITY-ARCHITECTURE.html'), resolve(root, 'SECURITY-ARCHITECTURE.html'));
        await writeFile(resolve(root, 'precache.json'), JSON.stringify((await files('')).filter((p) => p !== '/precache.json' && p !== '/.sw.template.js')));
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
