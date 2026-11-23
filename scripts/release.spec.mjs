import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseVersion } from './release-version.mjs';
import { packageRelease } from './package-release.mjs';

const run = promisify(execFile);

test('normalizes stable and prerelease versions for Git and Docker', () => {
  assert.deepEqual(releaseVersion('1.2.3'), { version: '1.2.3', tag: 'v1.2.3', prerelease: false });
  assert.deepEqual(releaseVersion('v2.0.0-rc.1'), { version: '2.0.0-rc.1', tag: 'v2.0.0-rc.1', prerelease: true });
  for (const invalid of [undefined, '', 'latest', '01.2.3', '1.2', '1.2.3+build.1', '1.2.3-01', '1.2.3;echo secret', '1.2.3\nlatest', '../1.2.3', `1.2.3-${'a'.repeat(128)}`]) {
    assert.throws(() => releaseVersion(invalid));
  }
});

test('packages a runnable build and default images without instance data, custom files or native dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'video-vault-release-test-'));
  try {
    for (const directory of ['built/lib', 'dynamodb', 'frontend/dist/assets', 'img', 'docker', 'conf', 'jwtkeys', 'node_modules', 'public']) await mkdir(join(root, directory), { recursive: true });
    for (const name of [
      'built/lib/index.js',
      'built/lib/initialize-config.js',
      'dynamodb/create-tables.json',
      'README.md',
      'logo.png',
      'frontend/dist/index.html',
      'frontend/dist/.sw.template.js',
      'frontend/dist/assets/app.js',
      'docker/INSTALL.md',
      'img/README.md',
      'img/default.logo.png',
      'img/default.icon-32.png',
      'img/default.icon-192.png',
      'img/default.icon-512.png',
      '.salt',
      'video-vault.db',
      'conf/db.json',
      'jwtkeys/private',
      'node_modules/native.node',
      'public/private-file',
      'img/private.logo.png'
    ])
      await writeFile(join(root, name), 'fixture');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'video-vault', version: '0.0.1', type: 'module', scripts: { start: 'node built/lib/index.js' } }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'video-vault', version: '0.0.1', packages: { '': { name: 'video-vault', version: '0.0.1' } } }));
    const archive = await packageRelease({ root, version: 'v1.2.3' });
    const { stdout } = await run('unzip', ['-Z1', archive]);
    const entries = stdout.trim().split('\n');
    for (const name of ['built/lib/index.js', 'public/index.html', 'public/.sw.template.js', 'public/assets/app.js', 'img/default.logo.png', 'img/default.icon-512.png', 'INSTALL.md', 'dynamodb/create-tables.json'])
      assert.ok(entries.includes(`video-vault/${name}`), name);
    assert.ok(entries.every((name) => name.startsWith('video-vault/')));
    assert.ok(entries.every((name) => !name.endsWith('/SECURITY-ARCHITECTURE.html')));
    assert.ok(entries.every((name) => !/(\.salt|\.db|conf\/|jwtkeys\/|node_modules\/|private)/.test(name)));
    const readme = (await run('unzip', ['-p', archive, 'video-vault/README.md'])).stdout;
    assert.ok(readme.includes('https://video-vault.de/SECURITY-ARCHITECTURE.html'));
    assert.ok(!readme.includes('](./SECURITY-ARCHITECTURE.html)'));
    const packaged = JSON.parse((await run('unzip', ['-p', archive, 'video-vault/package.json'])).stdout);
    assert.equal(packaged.version, '1.2.3');
    assert.equal(packaged.scripts.start, 'node built/lib/index.js');
    const lock = JSON.parse((await run('unzip', ['-p', archive, 'video-vault/package-lock.json'])).stdout);
    assert.equal(lock.version, '1.2.3');
    assert.equal(lock.packages[''].version, '1.2.3');
    const checksum = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    assert.equal(await readFile(`${archive}.sha256`, 'utf8'), `${checksum}  video-vault-v1.2.3.zip\n`);
    // Rebuilding a version must replace the archive rather than retain obsolete ZIP entries.
    await rm(join(root, 'frontend/dist/assets/app.js'));
    await packageRelease({ root, version: '1.2.3' });
    assert.ok(!(await run('unzip', ['-Z1', archive])).stdout.includes('assets/app.js'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
