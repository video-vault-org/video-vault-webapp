import { beforeEach, expect, test, vi } from 'vitest';

let handlers: Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>;
let addAll: ReturnType<typeof vi.fn>;
let skipWaiting: ReturnType<typeof vi.fn>;
let claim: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  handlers = new Map();
  addAll = vi.fn().mockResolvedValue(undefined);
  skipWaiting = vi.fn().mockResolvedValue(undefined);
  claim = vi.fn().mockResolvedValue(undefined);
  open = vi.fn().mockResolvedValue({ addAll });
  remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('self', {
    addEventListener: (type: string, handler: (event: { waitUntil: (promise: Promise<unknown>) => void }) => void) =>
      handlers.set(type, handler),
    skipWaiting,
    clients: { claim }
  });
  vi.stubGlobal('caches', { open, delete: remove, keys: vi.fn().mockResolvedValue([]) });
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, 'https://vault.test') : input, init);
      }
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(['/index.html', '/logo.png', '/icon-32.png'])))
  );
  await import('../sw');
});

const dispatch = async function (type: string) {
  let completion: Promise<unknown> | undefined;
  handlers.get(type)!({
    waitUntil: (promise) => {
      completion = promise;
    }
  });
  await completion;
};

test('versions the app cache by build and image content and reloads every precached resource from the network', async () => {
  await dispatch('install');
  expect(fetch).toHaveBeenCalledWith('/precache.json', { cache: 'no-store' });
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^vault-shell-.+-__VIDEOVAULT_IMAGES_VERSION__$/));
  const requests = addAll.mock.calls[0][0] as Request[];
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    '/index.html',
    '/logo.png',
    '/icon-32.png'
  ]);
  expect(requests.every((request) => request.cache === 'reload')).toBe(true);
  expect(addAll.mock.invocationCallOrder[0]).toBeLessThan(skipWaiting.mock.invocationCallOrder[0]);
});

test('a failed image fetch does not activate the new worker or remove the old cache', async () => {
  addAll.mockRejectedValueOnce(new Error('Offline'));
  await expect(dispatch('install')).rejects.toThrow('Offline');
  expect(skipWaiting).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('activation removes old app caches while retaining the current cache and unrelated caches', async () => {
  await dispatch('install');
  const current = open.mock.calls[0][0];
  vi.mocked(caches.keys).mockResolvedValueOnce(['vault-shell-old', current, 'other-application']);
  await dispatch('activate');
  expect(remove).toHaveBeenCalledExactlyOnceWith('vault-shell-old');
  expect(claim).toHaveBeenCalledOnce();
});
