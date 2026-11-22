import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordChange } from '../components/Accounts';
import { LanguageProvider } from '../lib/ui';
import { json } from '../lib/api';
import { pwned } from '../lib/password';
import { passwordAttributes } from '../lib/crypto';
import { config } from './fixtures';
import type { Keys, User } from '../lib/types';

vi.mock('../lib/api', async () => ({ ...(await vi.importActual('../lib/api')), json: vi.fn() }));

vi.mock('../lib/password', async () => ({ ...(await vi.importActual('../lib/password')), pwned: vi.fn() }));

vi.mock('../lib/crypto', async () => ({ ...(await vi.importActual('../lib/crypto')), passwordAttributes: vi.fn() }));

const user = { username: 'reader' } as User,
  keys = {} as Keys,
  attrs = { loginHash: 'hash', passwordKeySalt: 'salt', userKey: 'wrapped' };

beforeEach(() => {
  vi.mocked(json).mockResolvedValue(undefined);
  vi.mocked(pwned).mockResolvedValue('safe');
  vi.mocked(passwordAttributes).mockResolvedValue(attrs);
  vi.clearAllMocks();
});

const fill = async function (password: string, repeat = password) {
  const done = vi.fn().mockResolvedValue(undefined),
    actor = userEvent.setup();
  render(
    <LanguageProvider>
      <PasswordChange user={user} keys={keys} config={config} done={done} />
    </LanguageProvider>
  );
  await actor.type(screen.getByLabelText('Neues Passwort'), password);
  await actor.type(screen.getByLabelText('Passwort wiederholen'), repeat);
  await actor.click(screen.getByRole('button', { name: 'Passwort speichern' }));
  return { done, actor };
};

test('rejects missing character categories locally before contacting HIBP or the backend', async () => {
  // noinspection SpellCheckingInspection
  await fill('abcdefghijklmn');
  expect(await screen.findByRole('alert')).toHaveTextContent('drei der vier');
  expect(pwned).not.toHaveBeenCalled();
  expect(json).not.toHaveBeenCalled();
});

test('rejects mismatched confirmation before deriving keys', async () => {
  await fill('NewPassword123!', 'DifferentPassword123!');
  expect(await screen.findByRole('alert')).toHaveTextContent('stimmen nicht');
  expect(passwordAttributes).not.toHaveBeenCalled();
});

test('rejects a breached password and never saves new attributes', async () => {
  vi.mocked(pwned).mockResolvedValue('breached');
  await fill('NewPassword123!');
  expect(await screen.findByRole('alert')).toHaveTextContent('Datenleck');
  expect(json).not.toHaveBeenCalled();
});

test('allows HIBP outages with a visible warning and saves all password attributes together', async () => {
  vi.mocked(pwned).mockResolvedValue('unavailable');
  const { done } = await fill('NewPassword123!');
  expect(await screen.findByRole('status')).toHaveTextContent('trotzdem zugelassen');
  expect(passwordAttributes).toHaveBeenCalledWith('NewPassword123!', 'reader', config.instanceSalt, keys);
  expect(json).toHaveBeenCalledWith('/api/user/change/password', attrs, 'PATCH');
  expect(done).toHaveBeenCalledOnce();
});
