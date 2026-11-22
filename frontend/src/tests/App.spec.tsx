import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { config, video } from './fixtures';
import { BOOTSTRAP, TOKEN } from '../lib/api';
import * as cache from '../lib/cache';
import { verify, decryptText } from '../lib/crypto';

vi.mock('../lib/crypto', async () => {
  const actual = await vi.importActual('../lib/crypto');
  return {
    ...actual,
    loginHash: vi.fn().mockResolvedValue('login-hash'),
    unlock: vi.fn().mockResolvedValue({ encryption: {}, auth: {} }),
    verify: vi.fn().mockResolvedValue(undefined),
    decryptText: vi.fn(async (value: string) => (value === 'ciphertext' ? 'A walk' : 'By the river'))
  };
});

vi.mock('../components/Thumbnail', () => ({ Thumbnail: () => <div>thumbnail</div> }));

const user = {
  userId: 'u1',
  username: 'reader',
  displayName: 'Reader',
  passwordKeySalt: 'salt',
  userKey: 'wrapped',
  admin: false,
  editor: false,
  moderator: false
};
const token = `e30.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`;
let calls: string[];

beforeEach(async () => {
  await cache.removePrefix('');
  calls = [];

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input);
    calls.push(path);
    if (path === '/bootstrap') return new Response(JSON.stringify(config));
    if (path === '/login') return new Response(JSON.stringify({ token }));
    if (path === '/api/user/me') return new Response(JSON.stringify(user));
    if (path.startsWith('/api/video/'))
      return new Response(JSON.stringify([{ ...video, plainTitle: undefined, plainDescription: undefined }]));
    throw new Error(`Unexpected ${path}`);
  });
});

const login = async function () {
  const actor = userEvent.setup();
  render(<App />);
  await actor.type(await screen.findByLabelText('Benutzername'), 'reader');
  await actor.type(screen.getByLabelText('Passwort'), 'SomePassword1!');
  await actor.click(screen.getByRole('button', { name: 'Anmelden' }));
  await screen.findByRole('heading', { name: 'A walk' });
  return actor;
};

test('logs in, loads since=0, stores ciphertext only and grays out forbidden actions', async () => {
  const actor = await login();
  expect(localStorage.getItem(TOKEN)).toBe(token);
  expect(calls).toContain('/api/video/0');
  expect(screen.getByRole('button', { name: /Video hinzufügen/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Benutzerverwaltung' })).toBeDisabled();
  await waitFor(async () => {
    const stored = await cache.get<cache.Catalog>(`${config.instanceSalt}:u1:catalog`);
    expect(stored?.videos[0].title).toBe('ciphertext');
    expect(stored?.videos[0]).not.toHaveProperty('plainTitle');
  });
  await actor.click(screen.getByRole('button', { name: /Aktualisieren/ }));
  await waitFor(() => expect(calls).toContain(`/api/video/${Date.parse(video.lastModified)}`));
});

test('searches decrypted content and switches all navigation language', async () => {
  const actor = await login();
  await actor.type(screen.getByRole('searchbox', { name: 'Videos durchsuchen' }), 'not found');
  expect(screen.queryByRole('heading', { name: 'A walk' })).not.toBeInTheDocument();
  await actor.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
  expect(await screen.findByRole('heading', { name: 'A walk' })).toBeVisible();
  await actor.click(screen.getByRole('button', { name: 'Sprache wechseln' }));
  expect(screen.getByRole('button', { name: /Add video/ })).toBeDisabled();
  expect(screen.getByRole('link', { name: /Security architecture/ })).toBeVisible();
});

test('uses cached bootstrap and requests local password to unlock an existing JWT session', async () => {
  localStorage.setItem(TOKEN, token);
  localStorage.setItem(BOOTSTRAP, JSON.stringify(config));
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Archiv entsperren' })).toBeVisible();
  expect(calls).not.toContain('/bootstrap');
  expect(screen.queryByLabelText('Benutzername')).not.toBeInTheDocument();
  const actor = userEvent.setup();
  await actor.type(screen.getByLabelText('Passwort'), 'SomePassword1!');
  await actor.click(screen.getByRole('button', { name: 'Entsperren' }));
  expect(await screen.findByRole('heading', { name: 'A walk' })).toBeVisible();
  expect(calls).not.toContain('/login');
});

test('a 401 discards the token and returns to the login form', async () => {
  const actor = await login();
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
  await actor.click(screen.getByRole('button', { name: /Aktualisieren/ }));
  expect(await screen.findByRole('button', { name: 'Anmelden' })).toBeVisible();
  expect(localStorage.getItem(TOKEN)).toBeNull();
});

test('invitation links are scrubbed and require a password change before the catalog is shown', async () => {
  const invitation = { type: 'invite', username: 'reader', password: 'TemporaryPassword1!' };
  history.replaceState(null, '', '/#' + btoa(JSON.stringify(invitation)));
  const actor = userEvent.setup();
  render(<App />);
  await actor.click(await screen.findByRole('button', { name: 'Einladung / Reset öffnen' }));
  expect(await screen.findByRole('heading', { name: 'Bitte lege jetzt dein eigenes Passwort fest.' })).toBeVisible();
  expect(location.hash).toBe('');
  expect(calls).not.toContain('/api/video/0');
  expect(screen.queryByRole('heading', { name: 'A walk' })).not.toBeInTheDocument();
});

test('a tombstone prunes the offline video and thumbnail and advances the watermark without decrypting it', async () => {
  const actor = await login();
  const namespace = `${config.instanceSalt}:u1:`;
  await waitFor(async () => expect(await cache.get(namespace + 'catalog')).toBeDefined());
  await cache.put(namespace + 'thumb:v1', new Uint8Array([1]));
  const tombstone = {
    ...video,
    deleted: true,
    title: '',
    description: '',
    meta: {},
    videoMimeType: '',
    thumbnailMimeType: '',
    recorded: '1970-01-01T00:00:00.000Z',
    lastModified: '2026-11-01T00:00:00.000Z',
    hmac: ''
  };
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([tombstone])));
  vi.mocked(verify).mockClear();
  vi.mocked(decryptText).mockClear();
  await actor.click(screen.getByRole('button', { name: /Aktualisieren/ }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'A walk' })).not.toBeInTheDocument());
  expect(await cache.get(namespace + 'catalog')).toEqual({
    videos: [],
    since: String(Date.parse(tombstone.lastModified))
  });
  expect(await cache.get(namespace + 'thumb:v1')).toBeUndefined();
  expect(verify).not.toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), expect.anything());
  expect(decryptText).not.toHaveBeenCalledWith('', expect.anything(), expect.anything(), expect.anything());
  expect(calls).not.toContain('/api/video/catalog');
});
