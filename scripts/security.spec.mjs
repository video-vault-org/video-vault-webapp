import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSource } from './check-security.mjs';

const root = new URL('../', import.meta.url);

test('external workflow actions use immutable commit references', async () => {
  for (const name of await readdir(new URL('.github/workflows/', root))) {
    const text = await readFile(new URL(`.github/workflows/${name}`, root), { encoding: 'utf8' });
    assert(!text.includes('pull_request_target'), 'Untrusted PR code must not run with publishing credentials');
    for (const match of text.matchAll(/\buses:\s*([^\s#]+)/g)) {
      if (match[1].startsWith('./')) continue;
      assert.match(match[1], /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, `${name}: ${match[1]}`);
    }
    assert(!/npm (?:--prefix frontend )?install\b/.test(text), 'CI must use lockfiles');
  }
});

test('Docker code and integrity metadata are immutable to the runtime user', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', root), { encoding: 'utf8' });
  assert.match(dockerfile, /NODE_BUILD_IMAGE=node:26-bookworm@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /NODE_RUNTIME_IMAGE=node:26-bookworm-slim@sha256:[a-f0-9]{64}/);
  assert(!dockerfile.includes('--chown=node:node /build/public'));
  assert.match(dockerfile, /chmod -R a-w public\/assets public\/\.frontend-integrity.json public\/\.sw.template.js/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /npm ci --ignore-scripts/);
});

test('release build is read-only and publication does not run repository code or npm', async () => {
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), { encoding: 'utf8' });
  const build = workflow.split('  build:')[1].split('  release:')[0];
  assert(!build.includes('contents: write'));
  const publish = workflow
    .split('  release:')[1]
    .split('  docker:')[0]
    .replace(/^\s*#.*$/gm, '');
  assert(!/npm |uses: actions\/checkout|run: .*\.\//.test(publish));
  assert(publish.includes('actions/attest-build-provenance@'));
  assert(publish.includes('id-token: write'));
  assert(publish.includes('sha256sum'));
});

test('source check rejects executable content sinks and accepts plain React text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vault-source-check-'));
  try {
    await writeFile(join(directory, 'safe.tsx'), 'const view = <p>{untrusted}</p>;');
    await checkSource(directory);
    // noinspection JSUnusedLocalSymbols
    for (const source of ['element.innerHTML = untrusted;', 'const view = <div dangerouslySetInnerHTML={data} />;', 'eval(userInput);', 'new Function(userInput);']) {
      await writeFile(join(directory, 'unsafe.tsx'), source);
      await assert.rejects(checkSource(directory), /unsafe.tsx/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
