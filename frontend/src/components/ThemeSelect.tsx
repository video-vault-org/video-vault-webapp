import { useEffect, useState } from 'react';
import { applyTheme, getTheme, THEME, type Theme } from '../lib/theme';
import { useLanguage } from '../lib/ui';

const ThemeSelect = function () {
  const { t } = useLanguage();
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = function () {
      applyTheme('system');
    };
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, [theme]);

  return (
    <label className="theme-select">
      <span>{t('Design', 'Theme')}</span>
      <select
        value={theme}
        onChange={(event) => {
          const value = event.target.value as Theme;
          localStorage.setItem(THEME, value);
          setTheme(value);
        }}
      >
        <option value="light">{t('Hell', 'Light')}</option>
        <option value="dark">{t('Dunkel', 'Dark')}</option>
        <option value="system">{t('System', 'System')}</option>
      </select>
    </label>
  );
};

export { ThemeSelect };
