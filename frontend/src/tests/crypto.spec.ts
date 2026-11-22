// @vitest-environment node
import { beforeAll, expect, test, vi } from 'vitest';
import {
  bytes,
  concat,
  base64,
  unbase64,
  canonical,
  encrypt,
  decrypt,
  encryptText,
  decryptText,
  sign,
  verify,
  layout,
  CHUNK,
  WRAPPED,
  STRIDE
} from '../lib/crypto';
import { cipherRange, range, openMedia } from '../lib/ranges';
import type { Keys, User, Video } from '../lib/types';
import { request } from '../lib/api';

vi.mock('../lib/api', () => ({ request: vi.fn() }));

let keys: Keys;

beforeAll(async () => {
  keys = {
    encryption: await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey', 'unwrapKey']),
    auth: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, true, ['sign', 'verify'])
  };
});

test('canonical JSON sorts nested keys and refuses non-JSON numbers', () => {
  expect(canonical({ z: 1, a: { z: 2, a: 'ä' } })).toBe('{"a":{"a":"ä","z":2},"z":1}');
  expect(() => canonical(NaN)).toThrow();
});

test.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2])(
  'roundtrips %i bytes with authenticated empty and full chunks',
  async (size) => {
    const data = new Uint8Array(size).fill(42),
      cipher = await encrypt(new Blob([data]), 'video', 'v.video', keys);
    expect(layout(cipher.size)).toEqual({ count: Math.max(1, Math.ceil(size / CHUNK)), length: size });
    expect(bytes(await (await decrypt(cipher, 'video', 'v.video', keys)).arrayBuffer())).toEqual(data);
    await expect(decrypt(cipher, 'thumbnail', 'v.video', keys)).rejects.toThrow();
  }
);

test('detects tampering, truncation, reordering and wrong identities', async () => {
  const cipher = await encrypt(new Blob([new Uint8Array(CHUNK * 2)]), 'video', 'v.video', keys),
    data = bytes(await cipher.arrayBuffer());
  const changed = concat(data);
  changed[50] ^= 1;
  await expect(decrypt(new Blob([changed]), 'video', 'v.video', keys)).rejects.toThrow();
  await expect(decrypt(cipher.slice(0, 40 + STRIDE), 'video', 'v.video', keys)).rejects.toThrow();
  const swapped = new Blob([data.slice(0, 40), data.slice(40 + STRIDE), data.slice(40, 40 + STRIDE)]);
  await expect(decrypt(swapped, 'video', 'v.video', keys)).rejects.toThrow();
  await expect(decrypt(cipher, 'video', 'other.video', keys)).rejects.toThrow();
});

test('encrypts title/description independently and verifies metadata projection by stored text length', async () => {
  const title = await encryptText('Title', 'title', 'v', keys),
    description = await encryptText('Description', 'description', 'v', keys),
    video: Video = {
      videoId: 'v',
      title,
      description,
      recorded: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-02T00:00:00.000Z',
      meta: { a: 1 },
      videoMimeType: 'video/mp4',
      thumbnailMimeType: 'image/png',
      hmac: ''
    };
  expect(await decryptText(title, 'title', 'v', keys)).toBe('Title');
  await expect(decryptText(description, 'title', 'v', keys)).rejects.toThrow();
  video.hmac = await sign(video, keys);
  await expect(verify(video, keys)).resolves.toBeUndefined();
  await expect(verify({ ...video, meta: { a: 2 } }, keys)).rejects.toThrow('integrity');
});

test('matches Node RFC3394 wrapping and independent master key layout', async () => {
  const rawPassword = new Uint8Array(32).fill(7);
  const { createCipheriv } = await import('node:crypto');
  const enc = randomBytes32(2);

  const auth = randomBytes32(3);

  const wrap = (data: Uint8Array) => {
    const cipher = createCipheriv('id-aes256-wrap', rawPassword, Buffer.alloc(8, 0xa6));
    return Buffer.concat([cipher.update(data), cipher.final()]);
  };

  const user = {
    passwordKeySalt: base64(new Uint8Array(32).fill(1)),
    userKey: base64(concat(wrap(enc), wrap(auth)))
  } as User;
  // Unlock derivation is exercised in the real browser smoke; here verify the browser WebCrypto unwrap directly against Node's RFC3394 output.
  const wrapping = await crypto.subtle.importKey('raw', rawPassword, 'AES-KW', false, ['unwrapKey']);
  const restored = await crypto.subtle.unwrapKey(
    'raw',
    unbase64(user.userKey).slice(0, 40),
    wrapping,
    'AES-KW',
    'AES-KW',
    true,
    ['wrapKey']
  );
  expect(bytes(await crypto.subtle.exportKey('raw', restored))).toEqual(enc);
  expect(unbase64(user.userKey)).toHaveLength(80);
});

const randomBytes32 = function (value: number) {
  return new Uint8Array(32).fill(value);
};

test('range parser and mapping handle chunk boundaries, suffixes and incomplete requests', () => {
  const size = 40 + 2 * STRIDE;
  expect(cipherRange(CHUNK - 1, CHUNK, size)).toEqual({ first: 0, last: 1, from: 40, to: size - 1 });
  expect(range('bytes=-10', 100)).toEqual([90, 99]);
  expect(range('bytes=90-', 100)).toEqual([90, 99]);
  expect(() => range('bytes=100-', 100)).toThrow();
  expect(() => range('bytes=0-1,3-4', 100)).toThrow();
  expect(() => layout(WRAPPED + 1)).toThrow();
});

test('reads full ciphertext chunks but returns exactly a cross-boundary plaintext range', async () => {
  const plain = new Uint8Array(CHUNK * 3 + 7);
  for (let i = 0; i < plain.length; i++) plain[i] = i % 251;
  const cipher = bytes(await (await encrypt(new Blob([plain]), 'video', 'v.video', keys)).arrayBuffer());

  vi.mocked(request).mockImplementation(async (_path, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(cipher.length) } });
    const header = new Headers(init?.headers).get('Range')!;
    const [from, to] = range(header, cipher.length);
    return new Response(cipher.slice(from, to + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${from}-${to}/${cipher.length}` }
    });
  });

  const media = await openMedia({ videoId: 'v', videoMimeType: 'video/mp4' } as Video, keys);
  expect(media.size).toBe(plain.length);
  expect(await media.read(CHUNK - 3, CHUNK + 3)).toEqual(plain.slice(CHUNK - 3, CHUNK + 4));
  expect(new Headers(vi.mocked(request).mock.calls.at(-1)?.[1]?.headers).get('Range')).toBe(
    `bytes=40-${40 + 2 * STRIDE - 1}`
  );
  cipher[40 + STRIDE + 15] ^= 1;
  await expect(media.read(CHUNK, CHUNK + 1)).rejects.toThrow();
});
