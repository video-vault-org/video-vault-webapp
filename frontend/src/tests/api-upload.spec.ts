import { beforeEach, expect, test, vi } from 'vitest';
import { SESSION, upload, clearSession, sessionInfo } from '../lib/api';

let xhr: XMLHttpRequest;

beforeEach(async () => {
  xhr = {
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(),
    upload: {},
    status: 204
  } as unknown as XMLHttpRequest;
  vi.stubGlobal(
    'XMLHttpRequest',
    vi.fn(function () {
      return xhr;
    })
  );
  clearSession();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ authenticated: true, csrfToken: 'csrf', expiresAt: Date.now() + 3600_000 })));
  await sessionInfo();
});

test('uploads both files in one authenticated multipart request and reports byte progress', async () => {
  const data = new FormData(),
    progress = vi.fn(),
    finished = vi.fn();
  data.append('video', 'encrypted-video');
  data.append('thumbnail', 'encrypted-thumbnail');
  const pending = upload('/api/video/upload/v1', data, progress).then(finished);
  expect(xhr.open).toHaveBeenCalledWith('POST', '/api/video/upload/v1');
  expect(xhr.setRequestHeader).toHaveBeenCalledExactlyOnceWith('X-CSRF-Token', 'csrf');
  expect(xhr.send).toHaveBeenCalledExactlyOnceWith(data);
  xhr.upload.onprogress!.call(
    xhr,
    new ProgressEvent('progress', {
      lengthComputable: true,
      loaded: 25,
      total: 100
    })
  );
  expect(progress).toHaveBeenLastCalledWith(0.25);
  xhr.upload.onprogress!.call(xhr, new ProgressEvent('progress'));
  expect(progress).toHaveBeenCalledTimes(1);
  xhr.upload.onload!.call(xhr, new ProgressEvent('load'));
  expect(progress).toHaveBeenLastCalledWith(1);
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  xhr.onload!.call(xhr, new ProgressEvent('load'));
  await pending;
  expect(finished).toHaveBeenCalledOnce();
});

test.each([401, 403, 413, 500])('propagates HTTP %i and clears invalid tokens', async (status) => {
  Object.defineProperty(xhr, 'status', { value: status });
  const unauthorized = vi.fn();
  window.addEventListener('vault:unauthorized', unauthorized);
  try {
    const pending = upload('/api/video/upload/v1', new FormData(), vi.fn());
    //noinspection JSVoidFunctionReturnValueUsed it's not void, it's Promise<void>
    const rejected = expect(pending).rejects.toMatchObject({ status });
    xhr.onload!.call(xhr, new ProgressEvent('load'));
    await rejected;
    expect(localStorage.getItem(SESSION) === null).toBe(status === 401);
    expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
  } finally {
    window.removeEventListener('vault:unauthorized', unauthorized);
  }
});

test.each(['error', 'abort'] as const)('rejects upload %s instead of submitting metadata', async (event) => {
  const pending = upload('/api/video/upload/v1', new FormData(), vi.fn());
  //noinspection JSVoidFunctionReturnValueUsed it's not void, it's Promise<void>
  const rejected = expect(pending).rejects.toMatchObject({ name: event === 'error' ? 'TypeError' : 'AbortError' });
  xhr[event === 'error' ? 'onerror' : 'onabort']!.call(xhr, new ProgressEvent(event));
  await rejected;
});
