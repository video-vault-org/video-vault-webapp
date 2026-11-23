import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseVersion } from './release-version.mjs';

const run = promisify(execFile);

/** Packages only built code, generated frontend, default branding and installation material; never instance data or native dependencies. */
const packageRelease = async function ({ version, root = resolve(import.meta.dirname, '..'), output = join(root, 'release') }) {
  const release = releaseVersion(version);
  const temporary = await mkdtemp(join(tmpdir(), 'video-vault-release-'));
  try {
    const target = join(temporary, 'video-vault');
    await mkdir(target);
    for (const name of ['built', 'dynamodb', 'logo.png']) {
      await cp(join(root, name), join(target, name), { recursive: true });
    }
    // dist is rebuilt from scratch, unlike public which may also contain an operator's extra files.
    await cp(join(root, 'frontend/dist'), join(target, 'public'), { recursive: true });
    await mkdir(join(target, 'img'));
    for (const name of await readdir(join(root, 'img'))) {
      if (/^default\.(logo|icon-(32|192|512))\.png$/.test(name) || name === 'README.md') {
        await cp(join(root, 'img', name), join(target, 'img', name));
      }
    }
    for (const name of ['package.json', 'package-lock.json']) {
      const manifest = JSON.parse(await readFile(join(root, name), 'utf8'));
      manifest.version = release.version;
      if (manifest.packages?.['']) manifest.packages[''].version = release.version;
      await writeFile(join(target, name), JSON.stringify(manifest, null, 2) + '\n');
    }
    await cp(join(root, 'docker/INSTALL.md'), join(target, 'INSTALL.md'));
    await writeFile(
      join(target, 'README.md'),
      `# VideoVault ${release.tag}

![VideoVault logo](./logo.png)

This is the prebuilt distribution. Follow [INSTALL.md](./INSTALL.md) to install Node.js 26, install production dependencies, initialize and start the app. No source build is needed.

- [Security architecture (German/English)](https://video-vault.de/SECURITY-ARCHITECTURE.html).
- [DynamoDB table definitions](./dynamodb/create-tables.json).
- [Image configuration](./img/README.md).
- [Source repository and configuration guide](https://github.com/video-vault-org/video-vault-webapp).
`
    );

    await mkdir(output, { recursive: true });
    const archive = join(resolve(output), `video-vault-${release.tag}.zip`);
    await rm(archive, { force: true });
    await run('zip', ['-q', '-r', archive, 'video-vault'], { cwd: temporary });
    const checksum = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
    return archive;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const archive = await packageRelease({ version: process.argv[2] });
  console.log(archive);
}

export { packageRelease };
