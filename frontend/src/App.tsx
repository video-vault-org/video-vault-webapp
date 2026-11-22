import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, bootstrap, clearToken, json, TOKEN, tokenValid } from './lib/api';
import { createKeys, decryptText, loginHash, passwordAttributes, unlock, verify } from './lib/crypto';
import { get, removePrefix, emptyCatalog, mergeCatalog, saveCatalog, type Catalog } from './lib/cache';
import { excerpt, filterVideos, formatValue, sortVideos } from './lib/catalog';
import { clearMedia, installMediaBridge } from './lib/mediaBridge';
import { readInvitation, type Invitation } from './lib/password';
import type { Bootstrap, Keys, PlainVideo, User, Video } from './lib/types';
import { Dialog, ErrorMessage, Field, LanguageProvider, useLanguage, useTask } from './lib/ui';
import { Thumbnail } from './components/Thumbnail';
import { VideoOverlay } from './components/VideoOverlay';
import { VideoForm } from './components/VideoForm';
import { Account, PasswordChange, UserManagement } from './components/Accounts';
import { ThemeSelect } from './components/ThemeSelect';

const REPO = 'https://github.com/video-vault-org/video-vault-webapp';
const SECURITY = '/SECURITY-ARCHITECTURE.html';
const cachedUserKey = 'videovault.user';

const Login = function ({
  config,
  onLogin,
  cached,
  invitation
}: {
  config: Bootstrap;
  onLogin: (user: User, keys: Keys, forced: boolean) => void;
  cached?: User;
  invitation: Invitation | null;
}) {
  const { t } = useLanguage(),
    task = useTask(),
    [username, setUsername] = useState(invitation?.username ?? cached?.username ?? ''),
    [password, setPassword] = useState(invitation?.password ?? '');
  return (
    <main className="login">
      <section className="login-story">
        <span className="eyebrow">{t('VIDEO VAULT / PRIVATES ARCHIV', 'VIDEO VAULT / PRIVATE ARCHIVE')}</span>
        <h1>{t('Deine Momente.\nDein Schlüssel.', 'Your moments.\nYour key.')}</h1>
        <p>
          {t(
            'Ein privater Ort für die Geschichten, die bleiben. Ende-zu-Ende verschlüsselt — vom ersten Wort bis zum letzten Bild.',
            'A private home for the stories worth keeping. End-to-end encrypted — from the first word to the final frame.'
          )}
        </p>
        <div className="privacy-seal">
          <span>◇</span>
          {t('Lokal entschlüsselt. Gemeinsam bewahrt.', 'Locally decrypted. Shared with care.')}
        </div>
      </section>
      <section className="login-panel">
        <span className="eyebrow">{t('WILLKOMMEN ZURÜCK', 'WELCOME BACK')}</span>
        <h2>
          {invitation
            ? t('Zugang aktivieren', 'Activate access')
            : cached
              ? t('Archiv entsperren', 'Unlock archive')
              : t('Anmelden', 'Sign in')}
        </h2>
        <p className="muted">
          {cached
            ? t(
                'Dein Passwort entsperrt die Schlüssel nur lokal.',
                'Your password unlocks the keys locally only.'
              )
            : t(
                'Nur du und deine berechtigten Mitnutzer können die Inhalte entschlüsseln.',
                'Only you and authorized fellow users can decrypt the content.'
              )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task.run(async () => {
              let user = cached;
              if (!user) {
                const result = await json<{ token: string }>('/login', {
                  username,
                  loginHash: await loginHash(password, username, config.instanceSalt)
                });
                localStorage.setItem(TOKEN, result.token);
                user = await json<User>('/api/user/me');
              }
              if (user.userKey === '') {
                const generated = await createKeys();
                const { passwordKeySalt, userKey } = await passwordAttributes(
                  password,
                  user.username,
                  config.instanceSalt,
                  generated
                );
                try {
                  await json('/api/user/initialize-keys', { passwordKeySalt, userKey });
                } catch (error) {
                  // Another first login may already have stored its keys. Always reload and unlock the winner.
                  if (!(error instanceof ApiError && error.status === 409)) throw error;
                }
                user = await json<User>('/api/user/me');
              }
              const keys = await unlock(password, user);
              localStorage.setItem(cachedUserKey, JSON.stringify(user));
              setPassword('');
              onLogin(user, keys, !!invitation);
            });
          }}
        >
          {!cached && (
            <Field label={t('Benutzername', 'Username')}>
              <input
                autoComplete="username"
                value={username}
                required
                minLength={3}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
          )}
          {!invitation && (
            <Field label={t('Passwort', 'Password')}>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <ErrorMessage text={task.error} />
          <button className="primary wide" disabled={task.pending}>
            {task.pending
              ? t('Entsperren …', 'Unlocking …')
              : invitation
                ? t('Einladung / Reset öffnen', 'Open invitation / reset')
                : cached
                  ? t('Entsperren', 'Unlock')
                  : t('Anmelden', 'Sign in')}
          </button>
          {cached && (
            <button type="button" className="link-button" onClick={() => clearToken()}>
              {t('Mit anderem Konto anmelden', 'Use another account')}
            </button>
          )}
        </form>
        <p className="muted micro">
          {t(
            'Dein Passwort und deine entschlüsselten Schlüssel werden nicht gespeichert.',
            'Your password and decrypted keys are not stored.'
          )}
        </p>
      </section>
    </main>
  );
};

const Vault = function ({
  user,
  keys,
  config,
  refreshConfig,
  updated,
  logout
}: {
  user: User;
  keys: Keys;
  config: Bootstrap;
  refreshConfig: () => Promise<void>;
  updated: () => Promise<void>;
  logout: () => void;
}) {
  const { t, language } = useLanguage(),
    task = useTask(),
    namespace = `${config.instanceSalt}:${user.userId}:`;
  const [videos, setVideos] = useState<PlainVideo[]>([]),
    [selected, setSelected] = useState<PlainVideo>(),
    [form, setForm] = useState<PlainVideo | 'new'>(),
    [account, setAccount] = useState(false),
    [admin, setAdmin] = useState(false),
    [query, setQuery] = useState(''),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [offline, setOffline] = useState(!navigator.onLine),
    [ready, setReady] = useState(false);
  const active = useRef(true),
    syncing = useRef(false);
  const decode = useCallback(
    async (items: Video[]) => {
      const plain: PlainVideo[] = [];
      for (const item of items) {
        if (item.deleted) continue;
        await verify(item, keys);
        plain.push({
          ...item,
          plainTitle: await decryptText(item.title, 'title', item.videoId, keys),
          plainDescription: await decryptText(item.description, 'description', item.videoId, keys)
        });
      }
      return plain;
    },
    [keys]
  );

  const synchronize = async function () {
    if (syncing.current) return;
    syncing.current = true;
    try {
      await task.run(async () => {
        const previous = (await get<Catalog>(namespace + 'catalog')) ?? emptyCatalog();
        if (active.current) {
          setVideos(await decode(previous.videos));
          setReady(true);
        }
        try {
          const updates = await json<Video[]>(`/api/video/${previous.since}`),
            next = mergeCatalog(previous, updates),
            plain = await decode(next.videos);
          await saveCatalog(
            namespace,
            next,
            updates.filter((video) => video.deleted).map((video) => video.videoId)
          );
          if (active.current) {
            setVideos(plain);
            setSelected((old) => (old ? plain.find((video) => video.videoId === old.videoId) : undefined));
            setForm((old) =>
              old && old !== 'new' && !plain.some((video) => video.videoId === old.videoId) ? undefined : old
            );
            setOffline(false);
          }
        } catch (error) {
          if (error instanceof TypeError) {
            setOffline(true);
            return;
          }
          throw error;
        }
      });
    } finally {
      syncing.current = false;
    }
  };

  useEffect(() => {
    active.current = true;
    void synchronize();

    const online = () => void synchronize();

    const offline = () => setOffline(true);

    window.addEventListener('online', online);

    window.addEventListener('offline', offline);

    return () => {
      active.current = false;
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [namespace, keys]);

  const filtered = useMemo(
    () => sortVideos(filterVideos(videos, query, filters, config.meta), config.meta),
    [videos, query, filters, config.meta]
  );
  return (
    <>
      <main className="archive">
        <div className="page-heading">
          <div>
            <span className="eyebrow">{t('DEIN PRIVATES ARCHIV', 'YOUR PRIVATE ARCHIVE')}</span>
            <h1>{t('Geschichten, die bleiben.', 'Stories worth keeping.')}</h1>
            <p className="muted">
              {videos.length} {t('Videos · verschlüsselt gespeichert', 'videos · stored encrypted')}{' '}
              {offline && <span className="offline-badge">{t('Offline-Katalog', 'Offline catalog')}</span>}
            </p>
          </div>
          <div className="actions">
            <button disabled={task.pending} onClick={() => void synchronize()}>
              ↻ {t('Aktualisieren', 'Refresh')}
            </button>
            <button className="primary" disabled={!user.editor || offline} onClick={() => setForm('new')}>
              ＋ {t('Video hinzufügen', 'Add video')}
            </button>
          </div>
        </div>
        <nav className="archive-nav">
          <button onClick={() => setAccount(true)}>{t('Mein Konto', 'My account')}</button>
          <button disabled={!user.admin || offline} onClick={() => setAdmin(true)}>
            {t('Benutzerverwaltung', 'User management')}
          </button>
          <span className="nav-spacer" />
          <button onClick={() => void task.run(refreshConfig)} disabled={task.pending || offline}>
            {t('Anzeige-Konfiguration neu laden', 'Reload display settings')}
          </button>
        </nav>
        <section className="filter-bar" aria-label={t('Suche und Filter', 'Search and filters')}>
          <label className="search">
            <span>⌕</span>
            <input
              type="search"
              aria-label={t('Videos durchsuchen', 'Search videos')}
              placeholder={t('In deinem Archiv suchen …', 'Search your archive …')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {config.meta.recorded.useAsFilter && (
            <>
              <Field label={t('Aufgezeichnet ab', 'Recorded from')}>
                <input
                  type="date"
                  value={filters.recordedFrom ?? ''}
                  onChange={(e) => setFilters({ ...filters, recordedFrom: e.target.value })}
                />
              </Field>
              <Field label={t('bis', 'to')}>
                <input
                  type="date"
                  value={filters.recordedTo ?? ''}
                  onChange={(e) => setFilters({ ...filters, recordedTo: e.target.value })}
                />
              </Field>
            </>
          )}
          {config.meta.fields
            .filter((f) => f.useAsFilter)
            .map((f) => (
              <Field key={f.key} label={f.name}>
                {f.type === 'boolean' ? (
                  <select
                    value={filters[`meta:${f.key}`] ?? ''}
                    onChange={(e) => setFilters({ ...filters, [`meta:${f.key}`]: e.target.value })}
                  >
                    <option value="">{t('Alle', 'All')}</option>
                    <option value="true">{t('Ja', 'Yes')}</option>
                    <option value="false">{t('Nein', 'No')}</option>
                  </select>
                ) : (
                  <input
                    type={
                      f.type === 'number'
                        ? 'number'
                        : f.type === 'date'
                          ? 'date'
                          : f.type === 'datetime'
                            ? 'datetime-local'
                            : 'search'
                    }
                    step="any"
                    value={filters[`meta:${f.key}`] ?? ''}
                    onChange={(e) => setFilters({ ...filters, [`meta:${f.key}`]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          <button
            className="link-button"
            onClick={() => {
              setQuery('');
              setFilters({});
            }}
          >
            {t('Zurücksetzen', 'Reset')}
          </button>
        </section>
        <ErrorMessage text={task.error} />
        {task.pending && (
          <p role="status" className="muted">
            {t('Archiv wird synchronisiert …', 'Syncing archive …')}
          </p>
        )}
        <div className="result-heading">
          <span>{t('ALLE AUFNAHMEN', 'ALL RECORDINGS')}</span>
          <span>
            {filtered.length} / {videos.length}
          </span>
        </div>
        <section className="video-grid">
          {filtered.map((v, index) => (
            <article
              className="video-card"
              key={v.videoId}
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
            >
              <button
                className="tile-preview"
                onClick={() => setSelected(v)}
                aria-label={`${t('Abspielen', 'Play')}: ${v.plainTitle}`}
              >
                <Thumbnail video={v} keys={keys} namespace={namespace} />
                <span className="play-glyph">▶</span>
              </button>
              <div className="card-body">
                <small className="recorded">
                  {formatValue(
                    v.recorded,
                    { type: config.meta.recorded.withTime ? 'datetime' : 'date' },
                    language
                  )}
                </small>
                <h2>{v.plainTitle}</h2>
                <p>{excerpt(v.plainDescription)}</p>
                <button className="link-button" onClick={() => setSelected(v)}>
                  {t('Mehr Details', 'More details')} <span aria-hidden="true">↗</span>
                </button>
              </div>
            </article>
          ))}
        </section>
        {ready && !filtered.length && (
          <div className="empty">
            <span>◇</span>
            <h2>
              {videos.length
                ? t('Keine passenden Videos', 'No matching videos')
                : t('Platz für deine Erinnerungen.', 'Room for your memories.')}
            </h2>
            <p>
              {t(
                'Ändere die Filter oder füge ein erstes Video hinzu.',
                'Change the filters or add your first video.'
              )}
            </p>
          </div>
        )}
      </main>
      {selected && (
        <VideoOverlay
          video={selected}
          config={config}
          keys={keys}
          user={user}
          close={() => setSelected(undefined)}
          edit={() => {
            setForm(selected);
            setSelected(undefined);
          }}
          removed={synchronize}
        />
      )}
      {form && (
        <VideoForm
          existing={form === 'new' ? undefined : form}
          config={config}
          keys={keys}
          close={() => setForm(undefined)}
          saved={synchronize}
        />
      )}
      {account && (
        <Account
          user={user}
          keys={keys}
          config={config}
          close={() => setAccount(false)}
          updated={updated}
          logout={logout}
        />
      )}
      {admin && user.admin && (
        <UserManagement
          current={user}
          keys={keys}
          config={config}
          close={() => setAdmin(false)}
          updated={updated}
        />
      )}
    </>
  );
};

const Application = function () {
  const { t, language, setLanguage } = useLanguage(),
    task = useTask();
  const [config, setConfig] = useState<Bootstrap>(),
    [cached, setCached] = useState<User>(),
    [session, setSession] = useState<{ user: User; keys: Keys }>(),
    [forced, setForced] = useState(false),
    [passwordWarning, setPasswordWarning] = useState(false),
    [workerWarning, setWorkerWarning] = useState(false),
    [invitation, setInvitation] = useState(readInvitation);
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN);
    setSession(undefined);
    setCached(undefined);
    setForced(false);
    clearMedia();
  }, []);

  useEffect(() => {
    window.addEventListener('vault:unauthorized', logout);

    return () => window.removeEventListener('vault:unauthorized', logout);
  }, [logout]);

  const start = async function () {
    await task.run(async () => {
      if (!globalThis.crypto?.subtle) throw new Error('secure');
      const b = await bootstrap();
      setConfig(b);
      document.title = b.app.title;
      document.documentElement.lang = language;
      const token = localStorage.getItem(TOKEN);
      if (invitation) {
        logout();
        return;
      }
      if (!token || !tokenValid(token)) {
        logout();
        return;
      }
      let user: User;
      try {
        user = await json<User>('/api/user/me');
        localStorage.setItem(cachedUserKey, JSON.stringify(user));
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        const saved = localStorage.getItem(cachedUserKey);
        if (!saved) throw e;
        user = JSON.parse(saved);
      }
      setCached(user);
    });
  };

  useEffect(() => {
    void start();
    const cleanup = installMediaBridge();

    const passwordWarning = () => setPasswordWarning(true);

    const workerWarning = () => setWorkerWarning(true);

    const storage = (event: StorageEvent) => {
      if (event.key === TOKEN) {
        setSession(undefined);
        setCached(undefined);
        clearMedia();
        if (event.newValue)
          void json<User>('/api/user/me')
            .then(setCached)
            .catch(() => {});
      }
    };

    window.addEventListener('vault:password-check-unavailable', passwordWarning);

    window.addEventListener('vault:worker-error', workerWarning);

    window.addEventListener('storage', storage);

    return () => {
      cleanup();
      window.removeEventListener('vault:password-check-unavailable', passwordWarning);
      window.removeEventListener('vault:worker-error', workerWarning);
      window.removeEventListener('storage', storage);
    };
  }, []);

  const updated = async function () {
    const user = await json<User>('/api/user/me');
    localStorage.setItem(cachedUserKey, JSON.stringify(user));

    setSession((prior) => (prior ? { ...prior, user } : prior));
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
          }}
        >
          <img src="/logo.png" alt="" />
          <span>{config?.app.title ?? 'VideoVault'}</span>
        </a>
        <nav>
          <ThemeSelect />
          <a href={SECURITY} target="_blank" rel="noreferrer">
            {t('Sicherheitsarchitektur', 'Security architecture')} ↗
          </a>
          <button
            className="language"
            aria-label={t('Sprache wechseln', 'Change language')}
            onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
          >
            {language === 'de' ? 'EN' : 'DE'}
          </button>
          {session && <button onClick={logout}>{t('Abmelden', 'Sign out')}</button>}
        </nav>
      </header>
      {passwordWarning && (
        <p className="notice warning" role="status">
          {t(
            'Die Passwort-Leak-Prüfung war nicht erreichbar. Das Passwort wurde trotzdem zugelassen.',
            'The breached-password check was unavailable. The password was allowed anyway.'
          )}
        </p>
      )}
      {workerWarning && (
        <p className="notice warning" role="status">
          {t(
            'Der Service Worker konnte nicht gestartet werden. Offline-Modus und Wiedergabe sind nicht verfügbar. HTTP auf localhost wird unterstützt. Bitte Browser-Konsole und Browser-Einstellungen prüfen.',
            'The service worker could not start. Offline mode and playback are unavailable. HTTP on localhost is supported. Check the browser console and browser settings.'
          )}
        </p>
      )}
      {config && <ErrorMessage text={task.error} />}
      {!config ? (
        <main className="loading">
          <ErrorMessage text={task.error} />
          <button disabled={task.pending} onClick={() => void start()}>
            {task.pending
              ? t('Konfiguration laden …', 'Loading configuration …')
              : t('Erneut versuchen', 'Retry')}
          </button>
        </main>
      ) : session ? (
        forced ? (
          <main className="password-setup">
            <PasswordChange
              user={session.user}
              keys={session.keys}
              config={config}
              forced
              done={async () => {
                await updated();
                setForced(false);
              }}
            />
          </main>
        ) : (
          <Vault
            user={session.user}
            keys={session.keys}
            config={config}
            updated={updated}
            refreshConfig={async () => {
              const fresh = await bootstrap(true);
              setConfig(fresh);
              document.title = fresh.app.title;
            }}
            logout={logout}
          />
        )
      ) : (
        <Login
          config={config}
          cached={cached}
          invitation={invitation}
          onLogin={(user, keys, force) => {
            setSession({ user, keys });
            setForced(force);
            setInvitation(null);
          }}
        />
      )}
      <footer className="site-footer">
        <a href={REPO} target="_blank" rel="noreferrer">
          <img src="/videovault-logo.png" alt="" />
          Powered by <strong>VideoVault</strong> ↗
        </a>
        <span>{t('Privat geteilt. Lokal entschlüsselt.', 'Privately shared. Locally decrypted.')}</span>
        {session && (
          <button
            className="link-button"
            onClick={() =>
              void task.run(async () => {
                if (
                  confirm(
                    t(
                      'Offline-Katalog und gespeicherte Vorschaubilder dieses Kontos löschen?',
                      'Delete this account’s offline catalog and saved thumbnails?'
                    )
                  )
                ) {
                  await removePrefix(`${config?.instanceSalt}:${session.user.userId}:`);
                  logout();
                }
              })
            }
          >
            {t('Offline-Daten löschen', 'Clear offline data')}
          </button>
        )}
      </footer>
    </div>
  );
};

const App = function () {
  return (
    <LanguageProvider>
      <Application />
    </LanguageProvider>
  );
};

export { REPO };

export default App;
