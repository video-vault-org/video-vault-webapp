import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bind executable build assets and WASM to a build-time manifest; never derive trust from runtime file contents. */
const writeIntegrity = async function (root: string): Promise<void> {
  const files: Record<string, string> = {};
  for (const name of await readdir(join(root, 'assets'))) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Unexpected frontend asset path');
    files[`/assets/${name}`] = `sha256-${createHash('sha256')
      .update(await readFile(join(root, 'assets', name)))
      .digest('base64')}`;
  }
  files['/.sw.template.js'] = `sha256-${createHash('sha256')
    .update(await readFile(join(root, '.sw.template.js')))
    .digest('base64')}`;
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)];
  if (scripts.length !== 1 || !files[scripts[0][1]]) throw new Error('Expected one bundled frontend entry');
  const entry = scripts[0][1];
  await writeFile(
    join(root, 'index.html'),
    html.replace(scripts[0][0], scripts[0][0].replace('<script ', `<script integrity="${files[entry]}" `))
  );
  await writeFile(join(root, '.frontend-integrity.json'), JSON.stringify({ version: 1, entry, files }));
};

export { writeIntegrity };
