import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface FrontendSecurity {
  policy: string;
  assets: Map<string, Buffer>;
  worker?: () => Promise<Buffer>;
}

const basePolicy = "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";
const resourcePolicy = "connect-src 'self' data: https://api.pwnedpasswords.com/range/; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; frame-src 'self'; font-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'";
const workerPolicy = `${basePolicy}; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data:; worker-src 'self'`;

/** Validate every immutable build asset and keep its verified bytes in memory to prevent later file replacement. */
const loadFrontendSecurity = async function (directory: string, html: string): Promise<FrontendSecurity> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(directory, '.frontend-integrity.json'), 'utf8'));
  } catch (error) {
    // Non-executable static pages are supported, including isolated HTTP test fixtures.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' && !/<script\b/i.test(html)) return { policy: `${basePolicy}; ${resourcePolicy}; script-src 'none'`, assets: new Map() };
    throw new Error('Missing or invalid frontend integrity manifest; rebuild the frontend');
  }
  const manifest = raw as { version?: unknown; entry?: unknown; files?: unknown };
  if (manifest?.version !== 1 || typeof manifest.entry !== 'string' || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('Invalid frontend integrity manifest');
  const assets = new Map<string, Buffer>();
  const files = manifest.files as Record<string, unknown>;
  if (!/^\/assets\/[A-Za-z0-9_.-]+\.js$/.test(manifest.entry) || !Object.prototype.hasOwnProperty.call(files, manifest.entry) || !Object.prototype.hasOwnProperty.call(files, '/.sw.template.js')) throw new Error('Invalid frontend entry');
  for (const [path, expected] of Object.entries(files)) {
    if ((!/^\/assets\/[A-Za-z0-9_.-]+$/.test(path) && path !== '/.sw.template.js') || typeof expected !== 'string' || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(expected)) throw new Error('Invalid frontend integrity entry');
    const bytes = await readFile(join(directory, path.slice(1)));
    const actual = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    if (actual !== expected) throw new Error(`Frontend integrity check failed: ${path}`);
    assets.set(path, bytes);
  }
  const template = assets.get('/.sw.template.js')!.toString('utf8');
  const readWorker = async function (): Promise<Buffer> {
    const worker = await readFile(join(directory, 'sw.js'));
    const marker = '__VIDEOVAULT_IMAGES_VERSION__';
    const offset = template.indexOf(marker);
    const version = offset < 0 ? '' : worker.toString('utf8').slice(offset, offset + 64);
    if (!worker.equals(Buffer.from(template)) && (!/^[a-f0-9]{64}$/.test(version) || !worker.equals(Buffer.from(template.split(marker).join(version))))) throw new Error('Frontend service worker integrity check failed');
    return worker;
  };
  const worker = await readWorker();
  assets.delete('/.sw.template.js');
  assets.set('/sw.js', worker);
  // The build supplies SRI; a missing or modified entry tag must not silently weaken the policy.
  const scripts = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)];
  if (scripts.length !== 1 || !scripts[0][0].includes(`src="${manifest.entry}"`) || !scripts[0][0].includes(`integrity="${files[manifest.entry]}"`)) throw new Error('Invalid frontend entry HTML');
  return { policy: `${basePolicy}; ${resourcePolicy}; script-src '${files[manifest.entry]}' 'strict-dynamic' 'wasm-unsafe-eval'; script-src-attr 'none'`, assets, worker: readWorker };
};

export { basePolicy, workerPolicy, loadFrontendSecurity };
