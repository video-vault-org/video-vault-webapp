import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';
import type { Keys, User, Video, Comment, CommentDto } from './types';

const MEM_COST = 19 * 1024;

const CHUNK = 34 * 1024,
  WRAPPED = 40,
  OVERHEAD = 28,
  STRIDE = CHUNK + OVERHEAD;

const encoder = new TextEncoder();

const utf8 = (value: string) => encoder.encode(value);

const bytes = (value: ArrayBuffer | Uint8Array) => new Uint8Array(value);

const concat = function (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};

const base64 = function (data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
};

const unbase64 = function (text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
};

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const derive = async function (
  password: string,
  salt: string | Uint8Array
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await argon2.hash({
    pass: utf8(password),
    salt: typeof salt === 'string' ? utf8(salt) : salt,
    time: 2,
    mem: MEM_COST,
    parallelism: 1,
    hashLen: 32,
    type: argon2.ArgonType.Argon2id
  });
  return new Uint8Array(result.hash);
};

const key = (raw: Uint8Array, algorithm: string, usage: KeyUsage[], extractable = false) =>
  crypto.subtle.importKey(
    'raw',
    concat(raw),
    algorithm === 'HMAC' ? { name: 'HMAC', hash: 'SHA-256' } : algorithm,
    extractable,
    usage
  );

const loginHash = async function (password: string, username: string, salt: string): Promise<string> {
  const raw = await derive(password, salt + username);
  try {
    return base64(raw);
  } finally {
    raw.fill(0);
  }
};

/** Generates independent 256-bit archive keys in the browser; only wrapped keys leave the client. */
const createKeys = async function (): Promise<Keys> {
  return {
    encryption: await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, [
      'wrapKey',
      'unwrapKey'
    ]),
    auth: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, true, [
      'sign',
      'verify'
    ])
  };
};

const unlock = async function (password: string, user: User): Promise<Keys> {
  const raw = await derive(password, unbase64(user.passwordKeySalt));
  try {
    const wrapping = await key(raw, 'AES-KW', ['unwrapKey']);
    const wrapped = unbase64(user.userKey);
    if (wrapped.length !== 80) throw new Error('Invalid user key');
    return {
      encryption: await crypto.subtle.unwrapKey(
        'raw',
        wrapped.slice(0, 40),
        wrapping,
        'AES-KW',
        'AES-KW',
        true,
        ['wrapKey', 'unwrapKey']
      ),
      auth: await crypto.subtle.unwrapKey(
        'raw',
        wrapped.slice(40),
        wrapping,
        'AES-KW',
        { name: 'HMAC', hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      )
    };
  } finally {
    raw.fill(0);
  }
};

const passwordAttributes = async function (password: string, username: string, salt: string, keys: Keys) {
  const passwordKeySalt = random(32),
    raw = await derive(password, passwordKeySalt);
  try {
    const wrapping = await key(raw, 'AES-KW', ['wrapKey']);
    return {
      loginHash: await loginHash(password, username, salt),
      passwordKeySalt: base64(passwordKeySalt),
      userKey: base64(
        concat(
          bytes(await crypto.subtle.wrapKey('raw', keys.encryption, wrapping, 'AES-KW')),
          bytes(await crypto.subtle.wrapKey('raw', keys.auth, wrapping, 'AES-KW'))
        )
      )
    };
  } finally {
    raw.fill(0);
  }
};

/** RFC 8785 JSON for parsed JSON values. JS key sorting is UTF-16 order; JSON.stringify supplies number/string serialization. */
const canonical = function (value: unknown): string {
  if (
    typeof value === 'string' &&
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new Error('Invalid Unicode');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${canonical(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  throw new Error('Invalid canonical JSON');
};

const projection = function (item: Video | Comment) {
  const { hmac: _, ...rest } = item;
  if ('title' in rest)
    return {
      ...rest,
      title: rest.title.length,
      description: rest.description.length,
      recorded: new Date(rest.recorded).toISOString(),
      lastModified: new Date(rest.lastModified).toISOString()
    };
  // Names are current account metadata supplied by the server, not authenticated comment attributes.
  const { displayName: _displayName, ...comment } = rest as Omit<CommentDto, 'hmac'>;
  return {
    ...comment,
    content: comment.content.length,
    created: new Date(comment.created).toISOString(),
    lastModified: new Date(comment.lastModified).toISOString()
  };
};

const sign = async function (item: Video | Comment, keys: Keys): Promise<string> {
  return base64(bytes(await crypto.subtle.sign('HMAC', keys.auth, utf8(canonical(projection(item))))));
};

const verify = async function (item: Video | Comment, keys: Keys): Promise<void> {
  if (
    !(await crypto.subtle.verify('HMAC', keys.auth, unbase64(item.hmac), utf8(canonical(projection(item)))))
  )
    throw new Error('integrity');
};

const layout = function (size: number) {
  if (!Number.isSafeInteger(size) || size < WRAPPED + OVERHEAD) throw new Error('Invalid encrypted file');
  const count = Math.ceil((size - WRAPPED) / STRIDE),
    last = size - WRAPPED - (count - 1) * STRIDE;
  if (last < OVERHEAD || last > STRIDE || (count > 1 && last === OVERHEAD))
    throw new Error('Invalid encrypted chunks');
  return { count, length: (count - 1) * CHUNK + last - OVERHEAD };
};

const aad = (context: string, identity: string, index: number, count: number) =>
  utf8(canonical({ version: 1, context, identity, chunkIndex: index, chunkCount: count }));

/** Encrypted size is known before encryption, including key header, IVs and authentication tags. */
const encryptedFileSize = function (size: number): number {
  const result = WRAPPED + size + Math.max(1, Math.ceil(size / CHUNK)) * OVERHEAD;
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(result)) throw new RangeError('Invalid file size');
  return result;
};

/** Reads a small batch at a time; each yielded chunk retains the existing authenticated file format. */
const encryptChunks = async function* (
  blob: Blob,
  context: string,
  identity: string,
  keys: Pick<Keys, 'encryption'>
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  yield bytes(await crypto.subtle.wrapKey('raw', fileKey, keys.encryption, 'AES-KW'));
  const count = Math.max(1, Math.ceil(blob.size / CHUNK));
  const usedIVs = new Set<string>();
  const batchChunks = 32;
  for (let first = 0; first < count; first += batchChunks) {
    const batch = await blob.slice(first * CHUNK, (first + batchChunks) * CHUNK).arrayBuffer();
    for (let i = first; i < Math.min(count, first + batchChunks); i++) {
      let iv: Uint8Array<ArrayBuffer>;
      do {
        iv = random(12);
      } while (usedIVs.has(base64(iv)));
      usedIVs.add(base64(iv));
      const start = (i - first) * CHUNK;
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(context, identity, i, count), tagLength: 128 },
        fileKey,
        new Uint8Array(batch, start, Math.min(CHUNK, batch.byteLength - start))
      );
      yield concat(iv, bytes(encrypted));
    }
  }
};

/** Small in-memory values (titles, descriptions, comments); file uploads consume encryptChunks incrementally. */
const encrypt = async function (blob: Blob, context: string, identity: string, keys: Keys, onProgress?: (n: number) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  const count = Math.max(1, Math.ceil(blob.size / CHUNK));
  let index = 0;
  for await (const part of encryptChunks(blob, context, identity, keys)) {
    parts.push(part);
    if (index++ > 0) onProgress?.((index - 1) / count);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
};

const unwrapFile = async function (header: Uint8Array, keys: Keys): Promise<CryptoKey> {
  if (header.length !== 40) throw new Error('Invalid file key');
  return crypto.subtle.unwrapKey('raw', concat(header), keys.encryption, 'AES-KW', 'AES-GCM', false, [
    'decrypt'
  ]);
};

const decryptChunk = async function (
  data: Uint8Array,
  fileKey: CryptoKey,
  context: string,
  identity: string,
  index: number,
  count: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (data.length < 28) throw new Error('Incomplete chunk');
  return bytes(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: concat(data.subarray(0, 12)),
        additionalData: aad(context, identity, index, count),
        tagLength: 128
      },
      fileKey,
      concat(data.subarray(12))
    )
  );
};

const decrypt = async function (blob: Blob, context: string, identity: string, keys: Keys): Promise<Blob> {
  const { count } = layout(blob.size),
    fileKey = await unwrapFile(bytes(await blob.slice(0, 40).arrayBuffer()), keys),
    parts: BlobPart[] = [];
  for (let i = 0; i < count; i++)
    parts.push(
      await decryptChunk(
        bytes(await blob.slice(40 + i * STRIDE, Math.min(blob.size, 40 + (i + 1) * STRIDE)).arrayBuffer()),
        fileKey,
        context,
        identity,
        i,
        count
      )
    );
  return new Blob(parts);
};

const encryptText = async function (text: string, context: string, id: string, keys: Keys): Promise<string> {
  return base64(bytes(await (await encrypt(new Blob([text]), context, id, keys)).arrayBuffer()));
};

const decryptText = async function (text: string, context: string, id: string, keys: Keys): Promise<string> {
  return (await decrypt(new Blob([unbase64(text)]), context, id, keys)).text();
};

export {
  CHUNK,
  WRAPPED,
  OVERHEAD,
  STRIDE,
  utf8,
  bytes,
  concat,
  base64,
  unbase64,
  random,
  derive,
  loginHash,
  unlock,
  createKeys,
  passwordAttributes,
  canonical,
  sign,
  verify,
  layout,
  aad,
  encrypt,
  encryptChunks,
  encryptedFileSize,
  unwrapFile,
  decryptChunk,
  decrypt,
  encryptText,
  decryptText
};
