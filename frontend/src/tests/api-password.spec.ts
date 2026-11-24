import { expect, test, vi } from 'vitest';
import { bootstrap, BOOTSTRAP, clearToken, json, TOKEN, request, tokenValid } from '../lib/api';
import { inviteLink, passwordProblems, pwned, readInvitation, temporaryPassword } from '../lib/password';
import { config } from './fixtures';

const mockFetch = () => vi.spyOn(globalThis, 'fetch');

test('uses the cached bootstrap and refreshes it only on request', async () => {
  localStorage.setItem(BOOTSTRAP, JSON.stringify(config));
  const fetch = mockFetch().mockResolvedValue(new Response(JSON.stringify(config)));
  expect(await bootstrap()).toEqual(config);
  expect(fetch).not.toHaveBeenCalled();
  await bootstrap(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('loads dropdown options from bootstrap and preserves single/multiple text types', async () => {
  const dropdowns = { ...config, meta: { ...config.meta, fields: [false, true].map((multiple) => ({ ...config.meta.fields[0], key: multiple ? 'places' : 'place', multiple, options: ['Berlin', 'Paris'] })), sorting: [] } };
  mockFetch().mockResolvedValue(new Response(JSON.stringify(dropdowns)));
  expect(await bootstrap(true)).toEqual(dropdowns);
});

test.each([{ options: [] }, { options: ['Paris', 'Paris'] }, { options: [' '] }, { options: [1] }, { options: [' Paris '] }])('rejects malformed bootstrap dropdown options %j', async ({ options }) => {
  const invalid = { ...config, meta: { ...config.meta, fields: [{ ...config.meta.fields[0], options }] } };
  mockFetch().mockResolvedValue(new Response(JSON.stringify(invalid)));
  await expect(bootstrap(true)).rejects.toThrow('configuration');
});

test('uses Bearer tokens, never caches API responses and clears invalid tokens', async () => {
  localStorage.setItem(TOKEN, 'token');
  const fetch = mockFetch().mockResolvedValue(new Response(null, { status: 401 })),
    listener = vi.fn();

  window.addEventListener('vault:unauthorized', listener);

  await expect(json('/api/user/me')).rejects.toMatchObject({ status: 401 });
  expect(localStorage.getItem(TOKEN)).toBeNull();
  expect(listener).toHaveBeenCalled();
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer token');
  expect(fetch.mock.calls[0][1]?.cache).toBe('no-store');
  window.removeEventListener('vault:unauthorized', listener);
});

test('rejects a missing token without issuing a request and accepts 204', async () => {
  const fetch = mockFetch().mockResolvedValue(new Response(null, { status: 204 }));
  await expect(request('/api/video/0')).rejects.toMatchObject({ status: 401 });
  expect(fetch).not.toHaveBeenCalled();
  localStorage.setItem(TOKEN, 'token');
  await expect(json('/api/user/change/password', {}, 'PATCH')).resolves.toBeUndefined();
  clearToken();
});

test('validates token expiry for local startup only', () => {
  const token = (exp: number) => `e30.${btoa(JSON.stringify({ exp }))}.x`;

  expect(tokenValid(token(Date.now() / 1000 + 1000))).toBe(true);
  expect(tokenValid(token(1))).toBe(false);
  expect(tokenValid('invalid')).toBe(false);
});

test('enforces length and at least three character categories without forcing all four', () => {
  expect(passwordProblems('Short1!')).toContain('length');
  // noinspection SpellCheckingInspection
  expect(passwordProblems('abcdefghijklmnop')).toContain('categories');
  // noinspection SpellCheckingInspection
  expect(passwordProblems('Abcdefghijkl1')).toEqual([]);
  expect(passwordProblems(temporaryPassword())).toEqual([]);
});

test('HIBP sends only a 5-character prefix with padding, and matches suffixes locally', async () => {
  // noinspection SpellCheckingInspection
  const password = 'Abcdefghijkl1!',
    hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))), (n) =>
      n.toString(16).padStart(2, '0')
    )
      .join('')
      .toUpperCase();
  const fetch = mockFetch().mockResolvedValue(new Response(`${hash.slice(5)}:4\r\nOTHER:0`));
  expect(await pwned(password)).toBe('breached');
  expect(fetch.mock.calls[0][0]).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    headers: { 'Add-Padding': 'true' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer'
  });
  expect(JSON.stringify(fetch.mock.calls)).not.toContain(password);
});

test('HIBP ignores padding records and reports outages without blocking policy on its own', async () => {
  const fetch = mockFetch().mockResolvedValue(new Response('OTHER:0'));
  // noinspection SpellCheckingInspection
  expect(await pwned('Abcdefghijkl1!')).toBe('safe');
  fetch.mockRejectedValue(new TypeError('offline'));
  // noinspection SpellCheckingInspection
  expect(await pwned('Abcdefghijkl1!')).toBe('unavailable');
});

test('invitation JSON uses a base64url fragment and is immediately scrubbed', () => {
  const value = { type: 'invite' as const, username: 'üser', password: 'Aa1!secretSecret' },
    link = inviteLink(value);
  expect(link.split('#')[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  history.replaceState(null, '', `/#${link.split('#')[1]}`);
  expect(readInvitation()).toEqual(value);
  expect(location.hash).toBe('');
  history.replaceState(null, '', '/#invalid');
  expect(readInvitation()).toBeNull();
  expect(location.hash).toBe('');
});

test('discarding malformed cached bootstrap falls back to the validated server configuration', async () => {
  localStorage.setItem(
    BOOTSTRAP,
    JSON.stringify({
      ...config,
      meta: { ...config.meta, sorting: [{ source: 'meta', key: 'missing', direction: 'asc' }] }
    })
  );
  const fetch = mockFetch().mockResolvedValue(new Response(JSON.stringify(config)));
  expect(await bootstrap()).toEqual(config);
  expect(fetch).toHaveBeenCalledOnce();
});
