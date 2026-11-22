type Theme = 'light' | 'dark' | 'system';

const THEME = 'videovault.theme';

const getTheme = function (): Theme {
  const saved = localStorage.getItem(THEME);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
};

/** Applies the resolved theme to native controls and all application surfaces. */
const applyTheme = function (theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141d19' : '#f5f3ed');
};

export { THEME, getTheme, applyTheme };
export type { Theme };
