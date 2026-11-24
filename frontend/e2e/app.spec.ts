import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

const login = async function (page: Page, username = 'admin') {
  await page.goto('/');
  await page.getByLabel('Benutzername', { exact: true }).fill(username);
  await page.getByLabel('Passwort', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ein Sommer am See', exact: true })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
};

test.beforeEach(async ({ context }) => {
  await context.route('https://api.pwnedpasswords.com/**', (route) =>
    route.fulfill({ body: 'NONMATCHING:0', contentType: 'text/plain' })
  );
});

test('real Argon2 unlocks backend keys, ciphertext survives offline reload and locale changes', async ({
  page,
  context
}) => {
  const errors: string[] = [];

  page.on('pageerror', (e) => errors.push(e.message));

  await login(page, 'reader');
  await expect(page.getByRole('button', { name: /Video hinzufügen/ })).toBeDisabled();
  await expect(page.locator('.tile-preview img').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Personen', exact: true }).fill('Familie');
  await expect(page.locator('.video-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await expect(page.locator('.video-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Sprache wechseln' }).click();
  await expect(page.getByRole('button', { name: /Add video/ })).toBeDisabled();
  await expect(page.getByRole('searchbox', { name: 'People', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More details', exact: true }).first().click();
  const details = page.getByRole('dialog', { name: 'Ein Sommer am See', exact: true });
  await expect(details.locator('dt', { hasText: 'People' })).toBeVisible();
  await expect(details.locator('dt', { hasText: 'Category' })).toBeVisible();
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ein Sommer am See' })).toBeVisible();
  await expect(page.getByText('Offline catalog', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator('.tile-preview img')).toHaveCount(3);
  await page.screenshot({ path: '/tmp/vault-gallery.png', fullPage: true, animations: 'disabled' });
});

test('decrypts only requested full chunks for native video playback and a streamed download', async ({ page }) => {
  await login(page);
  const ranges: string[] = [];

  page.on('request', (r) => {
    if (r.url().includes('/api/video/file/')) ranges.push(r.headers()['range'] ?? r.method());
  });

  await page.getByRole('button', { name: 'Mehr Details', exact: true }).first().click();
  const player = page.locator('video');
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).duration)).toBeGreaterThan(0);
  await player.evaluate((v) => {
    (v as HTMLVideoElement).currentTime = 1;

    (v as HTMLVideoElement).play().catch(() => {});
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Herunterladen', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Ein Sommer am See.mp4');
  const path = await download.path();
  expect(await readFile(path!)).toEqual(await readFile(resolve('e2e/fixtures/sample.mp4')));
  expect(ranges).toContain('HEAD');
  expect(ranges.some((r) => r === 'bytes=0-39')).toBe(true);
  expect(ranges.some((r) => r.startsWith('bytes=40-'))).toBe(true);
});

test('recovers native playback when an active service worker does not control the reloaded page', async ({
  page,
  browserName
}) => {
  // Firefox's force reload leaves the document uncontrolled despite an active registration.
  test.skip(browserName !== 'firefox');
  await login(page);
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate(() => (location.reload as (forceGet: boolean) => void)(true))
  ]);
  await page.getByLabel('Passwort', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ein Sommer am See', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)).toBe('activated');
  const ranges: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/video/file/')) ranges.push(request.headers()['range'] ?? request.method());
  });
  await page.getByRole('button', { name: 'Mehr Details', exact: true }).first().click();
  await expect(page.locator('video')).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((video) => (video as HTMLVideoElement).duration))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  expect(ranges).toContain('HEAD');
  expect(ranges).toContain('bytes=0-39');
  expect(ranges.some((value) => value.startsWith('bytes=40-'))).toBe(true);
});

test('posts, edits and soft-deletes authenticated encrypted comments', async ({ page, browser }) => {
  await login(page);
  await page.getByRole('button', { name: 'Mehr Details', exact: true }).first().click();
  await page.getByRole('button', { name: 'Kommentare', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kommentare', exact: true });
  await dialog.getByLabel('Dein Kommentar').fill('Browser encrypted comment');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByText('Browser encrypted comment', { exact: true })).toBeVisible();
  await expect(dialog.locator('.comment small')).toContainText('Alex Morgan');
  const observer = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const reader = await observer.newPage();
    await login(reader, 'reader');
    await reader.getByRole('button', { name: 'Mehr Details', exact: true }).first().click();
    await reader.getByRole('button', { name: 'Kommentare', exact: true }).click();
    const observed = reader.getByRole('dialog', { name: 'Kommentare', exact: true });
    await expect(observed.getByText('Browser encrypted comment', { exact: true })).toBeVisible();
    await expect(observed.locator('.comment small')).toContainText('Alex Morgan');
    await expect(observed.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeDisabled();
  } finally {
    await observer.close();
  }

  await dialog.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Kommentar bearbeiten', exact: true }).fill('Edited comment');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByText('Edited comment', { exact: true })).toBeVisible();

  page.once('dialog', (d) => d.accept());

  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(dialog.getByText('Gelöscht')).toBeVisible();
});

test('analyzes local MP4, encrypts upload, changes metadata/files and deletes the video', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /Video hinzufügen/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Video hinzufügen', exact: true });
  await dialog.getByLabel('Titel', { exact: true }).fill('Browser upload');
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('Encrypted browser description');
  await dialog.getByLabel('Aufgezeichnet', { exact: true }).fill('2026-11-01');
  await dialog.getByLabel('Personen *', { exact: true }).fill('Ada\nBob');
  await dialog.getByRole('combobox', { name: 'Kategorie' }).selectOption('Travel');
  await dialog.locator('summary[aria-label="Schlagwörter"]').click();
  await dialog.getByRole('checkbox', { name: 'Holiday' }).check();
  await dialog.getByRole('checkbox', { name: 'Friends' }).check();
  await dialog.getByLabel('Videodatei', { exact: true }).setInputFiles('e2e/fixtures/sample.mp4');
  await dialog.getByLabel('Thumbnail', { exact: true }).setInputFiles('../logo.png');
  await expect(dialog.getByText('Geschätzte Browser-Unterstützung:', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser upload', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Kategorie' }).selectOption('Travel');
  await expect(page.locator('.video-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Kategorie' }).selectOption('');
  const card = page
    .locator('.video-card')
    .filter({ has: page.getByRole('heading', { name: 'Browser upload', exact: true }) });
  await card.getByRole('button', { name: 'Mehr Details', exact: true }).click();
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Video bearbeiten', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Kategorie' })).toHaveValue('Travel');
  await expect(dialog.locator('summary', { hasText: 'Holiday, Friends' })).toBeVisible();
  await dialog.getByLabel('Titel', { exact: true }).fill('Browser upload edited');
  await dialog.getByLabel('Beschreibung', { exact: true }).fill('Updated encrypted description');
  await dialog.getByLabel('Thumbnail ersetzen (optional)', { exact: true }).setInputFiles('../logo.png');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser upload edited', exact: true })).toBeVisible();
  await page
    .locator('.video-card')
    .filter({ has: page.getByRole('heading', { name: 'Browser upload edited', exact: true }) })
    .getByRole('button', { name: 'Mehr Details', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Browser upload edited', exact: true })
      .getByText('Updated encrypted description', { exact: true })
  ).toBeVisible();

  page.once('dialog', (d) => d.accept());

  const deletion = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().includes('/api/video/delete/')
  );
  await page.getByRole('button', { name: 'Löschen', exact: true }).click();
  const deletedRequest = await deletion;
  const deletedId = new URL(deletedRequest.url()).pathname.split('/').at(-1);
  expect(Number.isFinite(Date.parse(deletedRequest.postDataJSON().lastModified))).toBe(true);
  const token = await page.evaluate(() => localStorage.getItem('videovault.token'));
  await expect(page.getByRole('dialog', { name: 'Browser upload edited', exact: true })).not.toBeVisible();
  const changes = await page.request.get('/api/video/0', { headers: { authorization: `Bearer ${token}` } });
  expect(changes.status()).toBe(200);
  expect(await changes.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ videoId: deletedId, deleted: true, title: '', hmac: '' })])
  );
  await expect(page.getByRole('dialog', { name: 'Browser upload edited', exact: true })).not.toBeVisible();
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Browser upload edited', exact: true })
  ).not.toBeVisible();
});

test('creates an invitation, changes the invited password and can log in with the new credentials', async ({
  page,
  browser
}) => {
  await login(page);
  await page.getByRole('button', { name: 'Benutzerverwaltung', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Benutzerverwaltung', exact: true });
  await dialog.getByRole('button', { name: 'Nutzer hinzufügen', exact: true }).click();
  await dialog.getByLabel('Anzeigename', { exact: true }).fill('Invited Reader');
  await dialog.getByLabel('Benutzername', { exact: true }).fill('invited-reader');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  const field = dialog.getByRole('textbox', { name: 'Einladungs- oder Reset-Link' });
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4217' });
  await other.route('https://api.pwnedpasswords.com/**', (r) => r.fulfill({ body: 'NOTFOUND:0' }));
  const invited = await other.newPage();
  await invited.goto(link);
  await invited.getByRole('button', { name: 'Einladung / Reset öffnen', exact: true }).click();
  await invited.getByLabel('Neues Passwort', { exact: true }).fill('NewVaultPassword123!');
  await invited.getByLabel('Passwort wiederholen', { exact: true }).fill('NewVaultPassword123!');
  await invited.getByRole('button', { name: 'Passwort speichern', exact: true }).click();
  await expect(invited.getByRole('heading', { name: 'Ein Sommer am See', exact: true })).toBeVisible();
  expect(new URL(invited.url()).hash).toBe('');
  await invited.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await invited.getByLabel('Benutzername', { exact: true }).fill('invited-reader');
  await invited.getByLabel('Passwort', { exact: true }).fill('NewVaultPassword123!');
  await invited.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(invited.getByRole('heading', { name: 'Ein Sommer am See', exact: true })).toBeVisible();
  await expect(invited.getByRole('button', { name: /Video hinzufügen/ })).toBeDisabled();
  await other.close();
});

test('keeps the mobile archive within the viewport and offers the same account actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'reader');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Mein Konto', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/vault-mobile.png', fullPage: true, animations: 'disabled' });
});

test('updates cached branding without rebuilding, preserves unrelated caches and hides the worker template', async ({
  page
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith('vault-shell-')).length)
    )
    .toBe(1);
  const first = await page.evaluate(async () => (await caches.keys()).find((name) => name.startsWith('vault-shell-')));
  const original = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()))
  );
  await page.evaluate(async () => {
    const cache = await caches.open('branding-unrelated');
    await cache.put('/keep', new Response('keep'));
  });
  const switched = await page.request.post('/__test/images/fm');
  expect(switched.ok()).toBe(true);
  const { version } = await switched.json();
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).find((name) => name.startsWith('vault-shell-'))))
    .toContain(version);
  expect(await page.evaluate(() => caches.has('branding-unrelated'))).toBe(true);
  expect(await page.evaluate(async (name) => (await caches.keys()).includes(name!), first)).toBe(false);
  const replacement = await page.evaluate(async () =>
    Array.from(new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()))
  );
  expect(replacement).not.toEqual(original);
  await expect(page.locator('header img')).toHaveAttribute('src', '/logo.png');
  await expect(page.locator('footer img')).toHaveAttribute('src', '/videovault-logo.png');
  expect(
    await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch('/videovault-logo.png')).arrayBuffer()))
    )
  ).toEqual(original);
  expect((await page.request.get('/.sw.template.js')).status()).toBe(404);
  const manifest = await (await page.request.get('/precache.json')).json();
  expect(manifest).not.toContain('/.sw.template.js');
  expect(manifest).toContain('/videovault-logo.png');
  const unchanged = await page.request.post('/__test/images/fm');
  expect((await unchanged.json()).version).toBe(version);
  await page.context().setOffline(true);
  expect(
    await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch('/logo.png')).arrayBuffer())))
  ).toEqual(replacement);
  expect(
    await page.evaluate(async () =>
      Array.from(new Uint8Array(await (await fetch('/videovault-logo.png')).arrayBuffer()))
    )
  ).toEqual(original);
  await page.context().setOffline(false);
  await page.request.post('/__test/images/default');
});

test('registers a self-contained classic service worker over plain HTTP on localhost', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:4217/');
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(new URL(page.url()).protocol).toBe('http:');
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe('http://localhost:4217/sw.js');
  const source = await (await page.request.get('http://localhost:4217/sw.js')).text();
  expect(() => new Script(source)).not.toThrow();
  expect(source).not.toMatch(/\bimportScripts\s*\(/);
  await expect(page.getByText(/Der Service Worker konnte nicht gestartet werden/)).not.toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('first sign-in creates wrapped archive keys in the browser and unlocks them after reload', async ({ page }) => {
  let profile = {
    userId: 'first-admin',
    username: 'initial-admin',
    displayName: 'Initial admin',
    admin: true,
    editor: false,
    moderator: false,
    userKey: '',
    passwordKeySalt: ''
  };
  let initializations = 0;
  await page.route('**/login', (route) =>
    route.fulfill({
      json: {
        token: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`
      }
    })
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/user/me') return route.fulfill({ json: profile });
    if (path === '/api/user/initialize-keys') {
      initializations++;
      const attributes = route.request().postDataJSON();
      expect(Object.keys(attributes).sort()).toEqual(['passwordKeySalt', 'userKey']);
      expect(Buffer.from(attributes.passwordKeySalt, 'base64')).toHaveLength(32);
      expect(Buffer.from(attributes.userKey, 'base64')).toHaveLength(80);
      profile = { ...profile, ...attributes };
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/video/0') return route.fulfill({ json: [] });
    return route.abort();
  });
  await page.goto('/');
  await page.getByLabel('Benutzername', { exact: true }).fill(profile.username);
  await page.getByLabel('Passwort', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Benutzerverwaltung', exact: true })).toBeVisible();
  expect(initializations).toBe(1);
  const userKey = profile.userKey;
  await page.reload();
  await page.getByLabel('Passwort', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Benutzerverwaltung', exact: true })).toBeVisible();
  expect(initializations).toBe(1);
  expect(profile.userKey).toBe(userKey);
});
