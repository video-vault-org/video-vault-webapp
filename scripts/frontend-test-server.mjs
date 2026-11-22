// Isolated integration fixture: temporary storage, in-memory DB, no production config or secrets.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { InMemoryDatabaseAdapter } from '../built/lib/db/adapters/InMemoryDatabaseAdapter.js';
import { InMemoryStorageAdapter } from '../built/lib/storage/adapters/InMemoryStorageAdapter.js';
import { StorageWrapper } from '../built/lib/storage/StorageWrapper.js';
import { AuthService } from '../built/lib/service/AuthService.js';
import { UserService } from '../built/lib/service/UserService.js';
import { VideoService } from '../built/lib/service/VideoService.js';
import { CommentService } from '../built/lib/service/CommentService.js';
import { createApp } from '../built/lib/http/app.js';
import { deriveKey } from '../built/lib/util/deriveKey.js';
const root = resolve(import.meta.dirname, '..'),
  directory = await mkdtemp(join(tmpdir(), 'vault-browser-'));
const db = new InMemoryDatabaseAdapter(),
  adapter = new InMemoryStorageAdapter(),
  users = new UserService(db),
  salt = 'ab'.repeat(32),
  password = 'VaultTesting123!',
  master = randomBytes(32),
  authKey = randomBytes(32);

const canonical = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`;

const wrap = function (data, k) {
  const cipher = createCipheriv('id-aes256-wrap', k, Buffer.alloc(8, 0xa6));
  return Buffer.concat([cipher.update(data), cipher.final()]);
};

const encrypt = function (data, context, identity) {
  const key = randomBytes(32),
    parts = [wrap(key, master)],
    count = Math.max(1, Math.ceil(data.length / 34816));
  for (let i = 0; i < count; i++) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(canonical({ version: 1, context, identity, chunkIndex: i, chunkCount: count })));
    parts.push(iv, cipher.update(data.subarray(i * 34816, (i + 1) * 34816)), cipher.final(), cipher.getAuthTag());
  }
  return Buffer.concat(parts);
};

for (const username of ['admin', 'reader']) {
  const passwordKeySalt = randomBytes(32),
    passwordKey = await deriveKey(password, passwordKeySalt);
  await users.createUser({
    userId: username,
    username,
    displayName: username === 'admin' ? 'Alex Morgan' : 'Sam Reader',
    loginHash: (await deriveKey(password, salt + username)).toString('base64'),
    passwordKeySalt: passwordKeySalt.toString('base64'),
    userKey: Buffer.concat([wrap(master, passwordKey), wrap(authKey, passwordKey)]).toString('base64'),
    admin: username === 'admin',
    editor: username === 'admin',
    moderator: username === 'admin'
  });
}
const sample = await readFile(join(root, 'frontend/e2e/fixtures/sample.mp4')),
  thumbnail = await readFile(join(root, 'logo.png'));
for (const [id, title, description, date, people] of [
  ['v1', 'Ein Sommer am See', 'Ein stiller Morgen, warmes Licht und das Wasser vor uns. Erinnerungen an einen gemeinsamen Sommer.', '2026-08-12', ['Familie', 'Freunde']],
  ['v2', 'Unterwegs in den Bergen', 'Zwischen Gipfeln und Wolken: unser Wochenende im Grünen.', '2026-07-24', ['Freunde']],
  ['v3', 'Ein Abend im Garten', 'Gutes Essen, lange Gespräche und ein ganz besonderer Abend.', '2026-06-09', ['Familie']]
]) {
  const item = {
    videoId: id,
    title: encrypt(Buffer.from(title), 'title', id).toString('base64'),
    description: encrypt(Buffer.from(description), 'description', id).toString('base64'),
    meta: { people },
    recorded: new Date(date).toISOString(),
    lastModified: new Date(date).toISOString(),
    videoMimeType: 'video/mp4',
    thumbnailMimeType: 'image/png'
  };
  item.hmac = createHmac('sha256', authKey)
    .update(canonical({ ...item, title: item.title.length, description: item.description.length }))
    .digest('base64');
  await db.postVideo({ ...item, recorded: new Date(item.recorded), lastModified: new Date(item.lastModified) });
  for (const [kind, raw] of [
    ['video', sample],
    ['thumbnail', thumbnail]
  ]) {
    const path = join(directory, `${id}.${kind}`);
    await writeFile(path, encrypt(raw, kind, `${id}.${kind}`));
    await adapter.save(path, `${id}.${kind}`);
  }
}
const auth = new AuthService(db, { keyDirectory: join(directory, 'jwtkeys') });
await auth.initialize();
const app = createApp(
  { auth, users, videos: new VideoService(new StorageWrapper(adapter, { temporaryDirectory: directory }), db), comments: new CommentService(db) },
  {
    instanceSalt: salt,
    staticDirectory: join(root, 'public'),
    temporaryDirectory: directory,
    appConfig: { title: 'Our private archive' },
    metaConfig: {
      recorded: { withTime: false, useAsFilter: true },
      fields: [{ key: 'people', name: 'Personen', type: 'text', multiple: true, required: true, showInDetails: true, useAsFilter: true }],
      sorting: [
        { source: 'recorded', direction: 'desc' },
        { source: 'title', direction: 'asc' }
      ]
    },
    logger: false
  }
);
await app.listen({ host: '127.0.0.1', port: Number(process.env.FRONTEND_TEST_PORT ?? 4217) });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  });
