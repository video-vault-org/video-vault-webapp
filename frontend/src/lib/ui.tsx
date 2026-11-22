import {
  createContext,
  useContext,
  useState,
  useId,
  Children,
  isValidElement,
  cloneElement,
  type ReactNode
} from 'react';
import type { Language } from './types';
import { ApiError } from './api';

type T = (de: string, en: string) => string;

const LanguageContext = createContext<{ language: Language; t: T; setLanguage: (language: Language) => void }>({
  language: 'de',

  t: (de) => de,

  setLanguage: () => {}
});

const LanguageProvider = function ({ children }: { children: ReactNode }) {
  const [language, set] = useState<Language>(localStorage.getItem('videovault.language') === 'en' ? 'en' : 'de');

  const setLanguage = (value: Language) => {
    localStorage.setItem('videovault.language', value);
    document.documentElement.lang = value;
    set(value);
  };

  return (
    <LanguageContext.Provider value={{ language, t: (de, en) => (language === 'de' ? de : en), setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
};

const useLanguage = () => useContext(LanguageContext);

const errorText = (error: unknown, t: T) =>
  error instanceof ApiError
    ? error.status === 401
      ? t('Anmeldung erforderlich oder abgelaufen.', 'Sign-in required or expired.')
      : error.status === 403
        ? t('Keine Berechtigung.', 'Permission denied.')
        : error.status === 409
          ? t('Eintrag oder Benutzername existiert bereits.', 'Item or username already exists.')
          : error.status === 404
            ? t('Eintrag nicht gefunden.', 'Item not found.')
            : error.status === 413
              ? t('Die Datei ist zu groß.', 'The file is too large.')
              : t(
                  'Die Anfrage ist fehlgeschlagen. Bitte Daten prüfen und erneut versuchen.',
                  'The request failed. Check the input and try again.'
                )
    : error instanceof Error && error.message === 'password-policy'
      ? t(
          'Mindestens 12 Zeichen und drei der vier Zeichenarten sind erforderlich.',
          'At least 12 characters and three of the four character categories are required.'
        )
      : error instanceof Error && error.message === 'metadata'
        ? t(
            'Bitte Metadaten prüfen: Pflichtfelder ausfüllen und gültige Zahlen bzw. Datumswerte verwenden.',
            'Check metadata: fill required fields and use valid numbers or dates.'
          )
        : error instanceof Error && error.message === 'password-breached'
          ? t(
              'Dieses Passwort wurde in einem Datenleck gefunden. Bitte wähle ein anderes.',
              'This password was found in a breach. Please choose another.'
            )
          : error instanceof Error && error.message === 'password-match'
            ? t('Die Passwörter stimmen nicht überein.', 'The passwords do not match.')
            : error instanceof Error && error.message === 'own-username'
              ? t(
                  'Bitte ändere deinen eigenen Benutzernamen unter „Mein Konto“.',
                  'Please change your own username under “My account”.'
                )
              : error instanceof Error && error.message === 'integrity'
                ? t(
                    'Integritätsprüfung fehlgeschlagen. Die Daten werden nicht angezeigt.',
                    'Integrity check failed. The data will not be displayed.'
                  )
                : error instanceof Error && error.message === 'secure'
                  ? t(
                      'Für die Wiedergabe sind HTTPS und ein Service Worker erforderlich.',
                      'Playback requires HTTPS and a service worker.'
                    )
                  : t(
                      'Vorgang fehlgeschlagen. Bitte Verbindung, Passwort und Daten prüfen.',
                      'Operation failed. Check the connection, password and data.'
                    );

const useTask = function () {
  const { t } = useLanguage();
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');

  const run = async function (action: () => Promise<void>) {
    setPending(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorText(e, t));
      return false;
    } finally {
      setPending(false);
    }
  };

  return { pending, error, run, setError };
};

const ErrorMessage = function ({ text }: { text: string }) {
  return text ? (
    <p className="notice error" role="alert">
      {text}
    </p>
  ) : null;
};

const Dialog = function ({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Tab') {
            const items = e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input, select, textarea, a[href]'
            );
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button autoFocus className="icon-button" onClick={close} aria-label={t('Schließen', 'Close')}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
};

const Field = function ({ label, children }: { label: string; children: ReactNode }) {
  const id = useId(),
    items = Children.toArray(children);
  const first = items.findIndex((child) => isValidElement(child) && child.type !== 'small');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {items.map((child, index) =>
        index === first && isValidElement<{ id?: string }>(child) ? cloneElement(child, { id }) : child
      )}
    </div>
  );
};

export { T, LanguageProvider, useLanguage, errorText, useTask, ErrorMessage, Dialog, Field };
