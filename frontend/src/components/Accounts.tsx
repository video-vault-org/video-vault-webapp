import { useEffect, useState } from 'react';
import { json } from '../lib/api';
import { loginHash, passwordAttributes, unlock } from '../lib/crypto';
import { inviteLink, passwordProblems, pwned, temporaryPassword } from '../lib/password';
import type { Bootstrap, Keys, User } from '../lib/types';
import { Dialog, ErrorMessage, Field, useLanguage, useTask, type T } from '../lib/ui';

const validatePassword = async function (password: string, t: T): Promise<string> {
  const problems = passwordProblems(password);
  if (problems.length) throw new Error('password-policy');
  const result = await pwned(password);
  if (result === 'unavailable') window.dispatchEvent(new Event('vault:password-check-unavailable'));
  if (result === 'breached') throw new Error('password-breached');
  return result === 'unavailable'
    ? t(
        'Die Passwort-Leak-Prüfung war nicht erreichbar. Das Passwort wurde trotzdem zugelassen.',
        'The breached-password check was unavailable. The password was allowed anyway.'
      )
    : '';
};

const PasswordChange = function ({
  user,
  keys,
  config,
  done,
  forced = false
}: {
  user: User;
  keys: Keys;
  config: Bootstrap;
  done: () => Promise<void>;
  forced?: boolean;
}) {
  const { t } = useLanguage(),
    task = useTask(),
    [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [warning, setWarning] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void task.run(async () => {
          if (password !== repeat) throw new Error('password-match');
          const notice = await validatePassword(password, t);
          setWarning(notice);
          await json(
            '/api/user/change/password',
            await passwordAttributes(password, user.username, config.instanceSalt, keys),
            'PATCH'
          );
          setPassword('');
          setRepeat('');
          await done();
        });
      }}
    >
      <h3>
        {forced
          ? t('Bitte lege jetzt dein eigenes Passwort fest.', 'Please choose your own password now.')
          : t('Passwort ändern', 'Change password')}
      </h3>
      <p className="muted">
        {t(
          'Mindestens 12 Zeichen; mindestens drei Kategorien: Großbuchstaben, Kleinbuchstaben, Zahlen, Sonderzeichen.',
          'At least 12 characters; at least three categories: uppercase, lowercase, numbers, special characters.'
        )}
      </p>
      <Field label={t('Neues Passwort', 'New password')}>
        <input
          type="password"
          required
          minLength={12}
          maxLength={4096}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label={t('Passwort wiederholen', 'Repeat password')}>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </Field>
      <ErrorMessage text={task.error} />
      {warning && (
        <p role="status" className="notice warning">
          {warning}
        </p>
      )}
      <button className="primary" disabled={task.pending}>
        {task.pending ? t('Prüfen und speichern …', 'Checking and saving …') : t('Passwort speichern', 'Save password')}
      </button>
    </form>
  );
};

const Account = function ({
  user,
  keys,
  config,
  close,
  updated,
  logout
}: {
  user: User;
  keys: Keys;
  config: Bootstrap;
  close: () => void;
  updated: () => Promise<void>;
  logout: () => void;
}) {
  const { t } = useLanguage(),
    task = useTask(),
    [name, setName] = useState(user.displayName),
    [username, setUsername] = useState(user.username),
    [password, setPassword] = useState(''),
    [done, setDone] = useState(false);
  return (
    <Dialog title={t('Mein Konto', 'My account')} close={close}>
      <ErrorMessage text={task.error} />
      {done && <p role="status">{t('Gespeichert.', 'Saved.')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.run(async () => {
            await json(`/api/user/change/displayname/${encodeURIComponent(name)}`, undefined, 'PATCH');
            await updated();
            setDone(true);
          });
        }}
      >
        <Field label={t('Anzeigename', 'Display name')}>
          <input value={name} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <button disabled={task.pending}>{t('Anzeigename speichern', 'Save display name')}</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void task.run(async () => {
            await unlock(password, user);
            await json(
              `/api/user/change/username/${encodeURIComponent(username)}`,
              { loginHash: await loginHash(password, username, config.instanceSalt) },
              'PATCH'
            );
            setPassword('');
            await updated();
            setDone(true);
          });
        }}
      >
        <Field label={t('Benutzername', 'Username')}>
          <input required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field
          label={t(
            'Aktuelles Passwort zur Neuberechnung des Login-Hashes',
            'Current password to derive the new login hash'
          )}
        >
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button disabled={task.pending}>{t('Benutzername speichern', 'Save username')}</button>
      </form>
      <PasswordChange
        user={user}
        keys={keys}
        config={config}
        done={async () => {
          await updated();
          setDone(true);
        }}
      />
      <hr />
      <button
        className="danger"
        disabled={task.pending}
        onClick={() => {
          if (
            confirm(
              t(
                'Eigenes Konto löschen und alle eigenen Kommentare als gelöscht markieren?',
                'Delete your account and mark all your comments as deleted?'
              )
            )
          )
            void task.run(async () => {
              await json('/api/user/delete', undefined, 'DELETE');
              logout();
            });
        }}
      >
        {t('Konto löschen', 'Delete account')}
      </button>
    </Dialog>
  );
};

const UserManagement = function ({
  current,
  keys,
  config,
  close,
  updated
}: {
  current: User;
  keys: Keys;
  config: Bootstrap;
  close: () => void;
  updated: () => Promise<void>;
}) {
  const { t } = useLanguage(),
    task = useTask();
  const [users, setUsers] = useState<User[]>([]),
    [selected, setSelected] = useState<User>(),
    [create, setCreate] = useState(false),
    [name, setName] = useState(''),
    [username, setUsername] = useState(''),
    [roles, setRoles] = useState({ admin: false, editor: false, moderator: false }),
    [link, setLink] = useState(''),
    [warning, setWarning] = useState('');

  const load = async () => {
    setUsers(await json<User[]>('/api/user/all'));
  };

  useEffect(() => {
    void task.run(load);
  }, []);

  const select = function (user?: User) {
    setSelected(user);
    setCreate(!user);
    setName(user?.displayName ?? '');
    setUsername(user?.username ?? '');
    setRoles({ admin: user?.admin ?? false, editor: user?.editor ?? false, moderator: user?.moderator ?? false });
    setLink('');
  };

  const issue = async function (user: User, type: 'invite' | 'reset', targetUsername = user.username) {
    const password = temporaryPassword();
    setWarning(await validatePassword(password, t));
    const attrs = await passwordAttributes(password, targetUsername, config.instanceSalt, keys);
    if (type === 'invite') {
      await json('/api/user/add', { ...user, ...attrs });
    } else {
      if (targetUsername !== user.username)
        await json(
          `/api/user/change/username/${user.userId}/${encodeURIComponent(targetUsername)}`,
          { loginHash: attrs.loginHash },
          'PATCH'
        );
      await json(`/api/user/change/password/${user.userId}`, attrs, 'PATCH');
    }
    setLink(inviteLink({ type, username: targetUsername, password }));
  };

  return (
    <Dialog title={t('Benutzerverwaltung', 'User management')} close={close}>
      <ErrorMessage text={task.error} />
      <div className="user-layout">
        <nav className="user-list">
          <button className="primary" onClick={() => select()}>
            {t('Nutzer hinzufügen', 'Add user')}
          </button>
          {users.map((u) => (
            <button key={u.userId} onClick={() => select(u)}>
              {u.displayName}
              <small>@{u.username}</small>
            </button>
          ))}
        </nav>
        <div>
          {(selected || create) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void task.run(async () => {
                  if (selected?.userId === current.userId && username !== selected.username)
                    throw new Error('own-username');
                  if (create) {
                    const user: User = {
                      userId: crypto.randomUUID(),
                      username,
                      displayName: name,
                      ...roles,
                      userKey: '',
                      passwordKeySalt: ''
                    };
                    await issue(user, 'invite');
                    setCreate(false);
                  } else if (selected) {
                    await json(
                      `/api/user/change/displayname/${selected.userId}/${encodeURIComponent(name)}`,
                      undefined,
                      'PATCH'
                    );
                    for (const role of ['admin', 'editor', 'moderator'] as const)
                      if (roles[role] !== selected[role])
                        await json(`/api/user/change/${role}/${selected.userId}`, { [role]: roles[role] }, 'PATCH');
                    if (username !== selected.username) {
                      await issue(selected, 'reset', username);
                    }
                  }
                  await updated();
                  if (selected?.userId !== current.userId || roles.admin) await load();
                  setSelected(undefined);
                });
              }}
            >
              <Field label={t('Anzeigename', 'Display name')}>
                <input required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('Benutzername', 'Username')}>
                <input required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              {!create && (
                <p className="muted">
                  {t(
                    'Das Ändern des Benutzernamens erzeugt auch ein temporäres Passwort und einen Reset-Link. Eigene Änderungen bitte unter „Mein Konto“.',
                    'Changing a username also creates a temporary password and reset link. Use “My account” for your own changes.'
                  )}
                </p>
              )}
              <div className="actions">
                {(['admin', 'editor', 'moderator'] as const).map((role) => (
                  <label key={role}>
                    <input
                      type="checkbox"
                      checked={roles[role]}
                      onChange={(e) => setRoles({ ...roles, [role]: e.target.checked })}
                    />
                    {role === 'admin'
                      ? t('Administrator', 'Administrator')
                      : role === 'editor'
                        ? t('Redakteur', 'Editor')
                        : t('Moderator', 'Moderator')}
                  </label>
                ))}
              </div>
              <button className="primary" disabled={task.pending}>
                {t('Speichern', 'Save')}
              </button>
              {selected && (
                <div className="actions">
                  <button
                    type="button"
                    disabled={task.pending || selected.userId === current.userId}
                    onClick={() =>
                      void task.run(async () => {
                        await issue(selected, 'reset');
                        await load();
                      })
                    }
                  >
                    {t('Passwort zurücksetzen & Link erzeugen', 'Reset password & create link')}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={task.pending || selected.userId === current.userId}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            'Nutzer löschen und Kommentare als gelöscht markieren?',
                            'Delete user and mark their comments as deleted?'
                          )
                        )
                      )
                        void task.run(async () => {
                          await json(`/api/user/delete/${selected.userId}`, undefined, 'DELETE');
                          setSelected(undefined);
                          await load();
                        });
                    }}
                  >
                    {t('Nutzer löschen', 'Delete user')}
                  </button>
                </div>
              )}
            </form>
          )}
          {warning && <p className="notice warning">{warning}</p>}
          {link && (
            <section className="notice">
              <h3>{t('Einmalig angezeigter Zugangslink', 'Access link shown once')}</h3>
              <p>
                {t(
                  'Der Link enthält ein temporäres Passwort. Nur über einen vertraulichen Kanal weitergeben.',
                  'The link contains a temporary password. Share it through a confidential channel only.'
                )}
              </p>
              <textarea
                readOnly
                value={link}
                aria-label={t('Einladungs- oder Reset-Link', 'Invitation or reset link')}
              />
              <button
                onClick={() =>
                  void task.run(async () => {
                    await navigator.clipboard.writeText(link);
                  })
                }
              >
                {t('Link kopieren', 'Copy link')}
              </button>
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export { validatePassword, PasswordChange, Account, UserManagement };
