import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSelect } from '../components/ThemeSelect';
import { LanguageProvider } from '../lib/ui';
import { applyTheme, getTheme, THEME } from '../lib/theme';

let media: MediaQueryList;
let listener: (() => void) | undefined;

beforeEach(() => {
  listener = undefined;
  media = {
    matches: false,
    addEventListener: vi.fn((_type, callback) => {
      listener = callback;
    }),
    removeEventListener: vi.fn()
  } as unknown as MediaQueryList;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media)
  );
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

test('defaults to system and follows live system changes until a specific theme is selected', async () => {
  const actor = userEvent.setup();
  render(<ThemeSelect />);
  expect(screen.getByRole('combobox', { name: 'Design' })).toHaveValue('system');
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  Object.defineProperty(media, 'matches', { value: true, configurable: true });
  act(() => listener!());
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  const callback = listener;
  await actor.selectOptions(screen.getByRole('combobox'), 'light');
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  expect(localStorage.getItem(THEME)).toBe('light');
  expect(media.removeEventListener).toHaveBeenCalledWith('change', callback);
});

test('persists all three choices and restores the selected preference after remounting', async () => {
  const actor = userEvent.setup();
  const view = render(<ThemeSelect />);
  await actor.selectOptions(screen.getByRole('combobox'), 'dark');
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  expect(localStorage.getItem(THEME)).toBe('dark');
  view.unmount();
  render(<ThemeSelect />);
  expect(screen.getByRole('combobox')).toHaveValue('dark');
  await actor.selectOptions(screen.getByRole('combobox'), 'system');
  expect(localStorage.getItem(THEME)).toBe('system');
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
});

test('restores system mode with the current dark preference and removes its listener on unmount', () => {
  localStorage.setItem(THEME, 'system');
  Object.defineProperty(media, 'matches', { value: true, configurable: true });
  const view = render(<ThemeSelect />);
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
});

test('translates the header control and choices into English', () => {
  localStorage.setItem('videovault.language', 'en');
  render(
    <LanguageProvider>
      <ThemeSelect />
    </LanguageProvider>
  );
  expect(screen.getByRole('combobox', { name: 'Theme' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'Light' })).toHaveValue('light');
  expect(screen.getByRole('option', { name: 'Dark' })).toHaveValue('dark');
  expect(screen.getByRole('option', { name: 'System' })).toHaveValue('system');
});

test('falls back to system for invalid stored values and works without matchMedia', () => {
  localStorage.setItem(THEME, 'invalid');
  expect(getTheme()).toBe('system');
  vi.stubGlobal('matchMedia', undefined);
  applyTheme(getTheme());
  expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  applyTheme('dark');
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
});
