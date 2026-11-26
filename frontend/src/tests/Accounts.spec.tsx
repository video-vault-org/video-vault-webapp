import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Account, PasswordChange, UserManagement } from '../components/Accounts';
import { LanguageProvider } from '../lib/ui';
import { json } from '../lib/api';
import { pwned } from '../lib/password';
import { loginHash, passwordAttributes } from '../lib/crypto';
import { ApiError } from '../lib/api';
import { config } from './fixtures';
import type { Keys, User } from '../lib/types';

vi.mock('../lib/api', async () => ({ ...(await vi.importActual('../lib/api')), json: vi.fn() }));

vi.mock('../lib/password', async () => ({ ...(await vi.importActual('../lib/password')), pwned: vi.fn() }));

vi.mock('../lib/crypto', async () => ({
  ...(await vi.importActual('../lib/crypto')),
  passwordAttributes: vi.fn(),
  loginHash: vi.fn(),
  unlock: vi.fn()
}));

const user = { username: 'reader' } as User,
  keys = {} as Keys,
  attrs = { loginHash: 'hash', passwordKeySalt: 'salt', userKey: 'wrapped' };

beforeEach(() => {
  vi.mocked(json).mockResolvedValue(undefined);
  vi.mocked(pwned).mockResolvedValue('safe');
  vi.mocked(passwordAttributes).mockResolvedValue(attrs);
  vi.mocked(loginHash).mockResolvedValue('old-proof');
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
  await actor.type(screen.getByLabelText('Aktuelles Passwort'), 'OldPassword123!');
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
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/password',
    { ...attrs, oldLoginHash: 'old-proof' },
    'PATCH'
  );
  expect(loginHash).toHaveBeenCalledWith('OldPassword123!', user.username, config.instanceSalt);
  expect(done).toHaveBeenCalledOnce();
});

test('requires the current password and never submits a plaintext password', async () => {
  render(<PasswordChange user={user} keys={keys} config={config} done={vi.fn()} />);
  expect(screen.getByLabelText('Aktuelles Passwort')).toBeRequired();
  expect(screen.getByLabelText('Aktuelles Passwort')).toHaveAttribute('type', 'password');
});

test('shows a wrong-current-password error without completing or clearing the form', async () => {
  vi.mocked(json).mockRejectedValue(new ApiError(403));
  const { done } = await fill('NewPassword123!');
  expect(await screen.findByRole('alert')).toHaveTextContent('aktuelle Passwort ist falsch');
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Aktuelles Passwort')).toHaveValue('OldPassword123!');
});

test('uses the invitation temporary password in the required current-password field', async () => {
  render(
    <PasswordChange
      user={user}
      keys={keys}
      config={config}
      done={vi.fn()}
      forced
      initialCurrentPassword="TemporaryPassword123!"
    />
  );
  expect(screen.getByLabelText('Aktuelles Passwort')).toHaveValue('TemporaryPassword123!');
  expect(screen.getByLabelText('Aktuelles Passwort')).toBeRequired();
});

test('sends both the current and renamed username proofs when changing the own username', async () => {
  const actor = userEvent.setup();
  render(
    <Account
      user={{ ...user, displayName: 'Reader' }}
      keys={keys}
      config={config}
      close={vi.fn()}
      updated={vi.fn()}
      logout={vi.fn()}
    />
  );
  await actor.clear(screen.getByLabelText('Benutzername'));
  await actor.type(screen.getByLabelText('Benutzername'), 'renamed');
  await actor.type(
    screen.getByLabelText('Aktuelles Passwort zur Neuberechnung des Login-Hashes'),
    'OldPassword123!'
  );
  await actor.click(screen.getByRole('button', { name: 'Benutzername speichern' }));
  expect(loginHash).toHaveBeenCalledWith('OldPassword123!', 'renamed', config.instanceSalt);
  expect(loginHash).toHaveBeenCalledWith('OldPassword123!', user.username, config.instanceSalt);
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/username/renamed',
    { loginHash: 'old-proof', oldLoginHash: 'old-proof' },
    'PATCH'
  );
});

const openManagement = async function () {
  const administrator = {
    ...user,
    userId: 'admin',
    username: 'administrator',
    displayName: 'Administrator',
    admin: true,
    editor: false,
    moderator: false
  } as User;
  const target = {
    ...administrator,
    userId: 'target',
    username: 'target',
    displayName: 'Target',
    admin: false
  };
  vi.mocked(json).mockImplementation(async (path) =>
    path === '/api/user/all' ? [administrator, target] : undefined
  );
  render(
    <UserManagement current={administrator} keys={keys} config={config} close={vi.fn()} updated={vi.fn()} />
  );
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole('button', { name: /Target/ }));
  return { actor, administrator };
};

test('requires an admin password before resetting another account', async () => {
  const { actor } = await openManagement();
  await actor.click(screen.getByRole('button', { name: 'Passwort zurücksetzen & Link erzeugen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('aktuelle Passwort ist falsch');
  expect(passwordAttributes).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledTimes(1); // Only the read-only list request.
});

test('uses the acting admin username for the reset proof and clears the entered password', async () => {
  const { actor, administrator } = await openManagement();
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'AdminPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Passwort zurücksetzen & Link erzeugen' }));
  await screen.findByLabelText('Einladungs- oder Reset-Link');
  expect(loginHash).toHaveBeenCalledWith('AdminPassword123!', administrator.username, config.instanceSalt);
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/password/target',
    { ...attrs, oldLoginHash: 'old-proof' },
    'PATCH'
  );
  expect(screen.getByLabelText('Dein aktuelles Admin-Passwort')).toHaveValue('');
});

test('sends the admin proof for both steps of renaming and resetting another user', async () => {
  const { actor } = await openManagement();
  await actor.clear(screen.getByLabelText('Benutzername'));
  await actor.type(screen.getByLabelText('Benutzername'), 'renamed');
  expect(screen.getByLabelText('Dein aktuelles Admin-Passwort')).toBeRequired();
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'AdminPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByLabelText('Einladungs- oder Reset-Link');
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/username/target/renamed',
    { loginHash: attrs.loginHash, oldLoginHash: 'old-proof' },
    'PATCH'
  );
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/password/target',
    { ...attrs, oldLoginHash: 'old-proof' },
    'PATCH'
  );
});

test('a rejected admin proof never produces a reset link', async () => {
  const { actor } = await openManagement();
  vi.mocked(json).mockImplementation(async (path) => {
    if (path === '/api/user/change/password/target') throw new ApiError(403);
    return [];
  });
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'WrongPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Passwort zurücksetzen & Link erzeugen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('aktuelle Passwort ist falsch');
  expect(screen.queryByLabelText('Einladungs- oder Reset-Link')).not.toBeInTheDocument();
});

test('protects creating an account with the acting admin proof', async () => {
  const { actor } = await openManagement();
  await actor.click(screen.getByRole('button', { name: 'Nutzer hinzufügen' }));
  expect(screen.getByLabelText('Dein aktuelles Admin-Passwort')).toBeRequired();
  await actor.type(screen.getByLabelText('Anzeigename'), 'New member');
  await actor.type(screen.getByLabelText('Benutzername'), 'new-member');
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'AdminPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByLabelText('Einladungs- oder Reset-Link');
  expect(json).toHaveBeenCalledWith(
    '/api/user/add',
    expect.objectContaining({ username: 'new-member', oldLoginHash: 'old-proof' })
  );
});

test('protects display-name and role updates with one entered admin password', async () => {
  const { actor } = await openManagement();
  await actor.clear(screen.getByLabelText('Anzeigename'));
  await actor.type(screen.getByLabelText('Anzeigename'), 'Changed member');
  await actor.click(screen.getByRole('checkbox', { name: 'Administrator' }));
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'AdminPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByRole('button', { name: /Target/ });
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/displayname/target/Changed%20member',
    { oldLoginHash: 'old-proof' },
    'PATCH'
  );
  expect(json).toHaveBeenCalledWith(
    '/api/user/change/admin/target',
    { admin: true, oldLoginHash: 'old-proof' },
    'PATCH'
  );
});

test('protects deleting another user with the acting admin proof', async () => {
  const { actor } = await openManagement();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await actor.type(screen.getByLabelText('Dein aktuelles Admin-Passwort'), 'AdminPassword123!');
  await actor.click(screen.getByRole('button', { name: 'Nutzer löschen' }));
  await screen.findByRole('button', { name: /Target/ });
  expect(json).toHaveBeenCalledWith('/api/user/delete/target', { oldLoginHash: 'old-proof' }, 'DELETE');
});
