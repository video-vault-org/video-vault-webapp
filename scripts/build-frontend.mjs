import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Preserve unrelated public files; replace generated assets on each build.
const source = resolve('frontend/dist'),
  target = resolve('public');
await mkdir(target, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.name === 'assets') await rm(resolve(target, 'assets'), { recursive: true, force: true });
  await cp(resolve(source, entry.name), resolve(target, entry.name), { recursive: true });
}
