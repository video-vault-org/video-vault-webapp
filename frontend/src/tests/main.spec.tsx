import { beforeEach, afterEach, expect, test, vi } from 'vitest';

vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render: vi.fn() })) }));

vi.mock('../App', () => ({ default: () => null }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PROD', true);
  vi.stubGlobal('location', new URL('http://localhost:3210/'));
  vi.stubGlobal('isSecureContext', true);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('registers a classic worker on HTTP localhost without requiring module-worker support', async () => {
  const register = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  await import('../main');
  expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { updateViaCache: 'none' });
  expect(location.protocol).toBe('http:');
});

test('reports the original registration error in the console and signals the UI', async () => {
  const error = new Error('Registration rejected');
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn().mockRejectedValue(error) } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warning = vi.fn();
  window.addEventListener('vault:worker-error', warning, { once: true });
  await import('../main');
  expect(log).toHaveBeenCalledWith('Service worker registration failed:', error);
  expect(warning).toHaveBeenCalledOnce();
});

test('does not register a production worker in the development server', async () => {
  vi.stubEnv('PROD', false);
  const register = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  await import('../main');
  expect(register).not.toHaveBeenCalled();
});

test('applies the saved theme before rendering the application', async () => {
  localStorage.setItem('videovault.theme', 'dark');
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn().mockResolvedValue(undefined) } });
  const { createRoot } = await import('react-dom/client');
  vi.mocked(createRoot).mockImplementationOnce(() => {
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    return { render: vi.fn() } as unknown as ReturnType<typeof createRoot>;
  });
  await import('../main');
});
