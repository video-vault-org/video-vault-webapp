import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '@/http/app';
import { loadFrontendSecurity } from '@/http/frontendSecurity';

const digest = (bytes: string) => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

describe('verified frontend and strict CSP', () => {
  let directory: string;
  const script = 'globalThis.trusted = true;';
  const template = "self.version = '__VIDEOVAULT_IMAGES_VERSION__';";
  const html = `<script type="module" src="/assets/app.js" integrity="${digest(script)}"></script>`;
  const manifest = { version: 1, entry: '/assets/app.js', files: { '/assets/app.js': digest(script), '/.sw.template.js': digest(template) } };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vault-frontend-security-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), html);
    await writeFile(join(directory, 'assets/app.js'), script);
    await writeFile(join(directory, '.sw.template.js'), template);
    await writeFile(join(directory, 'sw.js'), template.replace('__VIDEOVAULT_IMAGES_VERSION__', 'a'.repeat(64)));
    await writeFile(join(directory, '.frontend-integrity.json'), JSON.stringify(manifest));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('permits only the integrity-pinned entry and stores verified immutable bytes', async () => {
    const loaded = await loadFrontendSecurity(directory, html);
    expect(loaded.policy).toContain(`script-src '${digest(script)}' 'strict-dynamic' 'wasm-unsafe-eval'`);
    expect(loaded.policy).toContain("script-src-attr 'none'");
    expect(loaded.policy).not.toContain("script-src 'self'");
    expect(loaded.policy).not.toContain("'unsafe-eval'");
    expect(loaded.policy).toContain("frame-ancestors 'none'");
    await writeFile(join(directory, 'assets/app.js'), 'globalThis.compromised = true;');
    expect(loaded.assets.get('/assets/app.js')?.toString()).toBe(script);
    await expect(loadFrontendSecurity(directory, html)).rejects.toThrow('integrity check failed');
  });

  test('HTTP serves only verified assets and sets restrictive page headers', async () => {
    const services = { auth: { findSession: jest.fn(), authorize: jest.fn() }, users: {}, videos: {}, comments: {} } as unknown as Parameters<typeof createApp>[0];
    const app = createApp(services, { staticDirectory: directory, temporaryDirectory: directory, instanceSalt: 'ab'.repeat(32), logger: false });
    try {
      await app.ready();
      const page = await app.inject('/');
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-security-policy']).toContain("'strict-dynamic'");
      expect(page.headers['referrer-policy']).toBe('no-referrer');
      expect(page.headers['x-content-type-options']).toBe('nosniff');
      await writeFile(join(directory, 'assets/app.js'), 'compromised();');
      await writeFile(join(directory, 'assets/unapproved.js'), 'injected();');
      expect((await app.inject('/assets/app.js')).body).toBe(script);
      expect((await app.inject('/assets/unapproved.js')).statusCode).toBe(404);
      expect((await app.inject('/.frontend-integrity.json')).statusCode).toBe(404);
      const rebranded = template.replace('__VIDEOVAULT_IMAGES_VERSION__', 'b'.repeat(64));
      await writeFile(join(directory, 'sw.js'), rebranded);
      expect((await app.inject('/sw.js')).body).toBe(rebranded);
      await writeFile(join(directory, 'sw.js'), 'malicious();');
      expect((await app.inject('/sw.js')).statusCode).toBe(500);
    } finally {
      await app.close();
    }
  });

  test.each(['assets/app.js', '.sw.template.js', 'sw.js'])('rejects modification of %s before startup', async (path) => {
    await writeFile(join(directory, path), 'malicious();');
    await expect(loadFrontendSecurity(directory, html)).rejects.toThrow(/integrity check failed/);
  });

  test('excludes pages, assets, API responses and errors from search indexing, including HEAD responses', async () => {
    await writeFile(join(directory, 'static.txt'), 'Public file');
    const services = { auth: { findSession: jest.fn(), authorize: jest.fn() }, users: {}, videos: {}, comments: {} } as unknown as Parameters<typeof createApp>[0];
    const app = createApp(services, { staticDirectory: directory, temporaryDirectory: directory, instanceSalt: 'ab'.repeat(32), logger: false });
    try {
      await app.ready();
      for (const [url, status] of [
        ['/', 200],
        ['/index.html', 200],
        ['/assets/app.js', 200],
        ['/static.txt', 200],
        ['/sw.js', 200],
        ['/bootstrap', 200],
        ['/docs/', 200],
        ['/docs/json', 200],
        ['/api/user/me', 401],
        ['/missing', 404]
      ] as const) {
        for (const method of ['GET', 'HEAD'] as const) {
          const response = await app.inject({ method, url });
          expect({ method, url, status: response.statusCode, robots: response.headers['x-robots-tag'] }).toEqual({ method, url, status, robots: 'noindex, nofollow, noimageindex' });
        }
      }
    } finally {
      await app.close();
    }
  });

  test('rejects executable pages without their manifest or SRI entry', async () => {
    // noinspection HtmlUnknownTarget
    await expect(loadFrontendSecurity(directory, '<script src="/assets/app.js"></script>')).rejects.toThrow('entry HTML');
    await expect(loadFrontendSecurity(directory, html + '<script>alert(1)</script>')).rejects.toThrow('entry HTML');
    await rm(join(directory, '.frontend-integrity.json'));
    await expect(loadFrontendSecurity(directory, html)).rejects.toThrow('integrity manifest');
    expect((await loadFrontendSecurity(directory, '<h1>Static page</h1>')).policy).toContain("script-src 'none'");
  });

  test.each(['../private', '/assets/../private', '/assets/sub/file.js', '/.other.js'])('rejects invalid manifest paths: %s', async (path) => {
    await writeFile(join(directory, '.frontend-integrity.json'), JSON.stringify({ ...manifest, files: { ...manifest.files, [path]: digest('x') } }));
    await expect(loadFrontendSecurity(directory, html)).rejects.toThrow('integrity entry');
  });
});
