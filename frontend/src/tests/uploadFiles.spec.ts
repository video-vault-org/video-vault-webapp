import { beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { uploadFiles } from '../lib/uploadFiles';
import { encryptedFileSize } from '../lib/crypto';
import { clearSession } from '../lib/api';

interface WorkerStub {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

let workers: WorkerStub[];
let failWorker: boolean;
const uploadId = '6c023fc2-7297-4f5f-8ca0-cdb6da5d1492';
const session = `/api/video/upload/v/${uploadId}`;

beforeEach(() => {
  clearSession();
  workers = [];
  failWorker = false;
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: WorkerStub['onmessage'];
      onerror?: () => void;
      // noinspection JSUnusedGlobalSymbols used by vite tests
      terminate = vi.fn();
      // noinspection JSUnusedGlobalSymbols used by vite tests
      postMessage = vi.fn((message) => {
        if (message.type === 'encrypt') {
          if (failWorker) {
            this.onerror?.();
            return;
          }
          const size = encryptedFileSize(message.file.size);
          this.onmessage?.({ data: { type: 'progress', bytes: size } });
          this.onmessage?.({ data: { type: 'packet', offset: 0, data: new ArrayBuffer(size) } });
        } else this.onmessage?.({ data: { type: 'done' } });
      });
      constructor() {
        workers.push(this);
      }
    }
  );
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === '/session') return new Response(JSON.stringify({ authenticated: true, csrfToken: 'csrf', expiresAt: Date.now() + 3600_000 }));
    if (String(input).endsWith('/start'))
      return new Response(JSON.stringify({ uploadId, maxPartBytes: 4 * 1024 ** 2 }), { status: 201 });
    if (init?.method === 'PUT')
      return new Response(JSON.stringify({ received: (init.body as ArrayBuffer).byteLength }));
    return new Response(null, { status: 204 });
  });
});

const options = function (onProgress = vi.fn(), controller = new AbortController()) {
  return {
    videoId: 'v',
    files: [{ kind: 'video' as const, file: new File(['hello'], 'source.mp4') }],
    key: {} as CryptoKey,
    signal: controller.signal,
    onProgress
  };
};

test('preflights before worker creation and counts server acknowledgements rather than queued bytes', async () => {
  let acknowledge: ((response: Response) => void) | undefined;
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) =>
    init?.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          acknowledge = resolve;
        })
      : original(input, init)
  );
  const progress = vi.fn();
  const input = options(progress);
  const running = uploadFiles(input);
  await waitFor(() => expect(acknowledge).toBeDefined());
  expect(progress).toHaveBeenLastCalledWith({ encrypted: 1, uploaded: 0 });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/start'))?.[1]?.body))).toEqual({
    files: [{ kind: 'video', size: encryptedFileSize(5) }]
  });
  acknowledge!(new Response(JSON.stringify({ received: encryptedFileSize(5) })));
  await running;
  expect(progress).toHaveBeenLastCalledWith({ encrypted: 1, uploaded: 1 });
  expect(fetch).toHaveBeenCalledWith(`${session}/complete`, expect.objectContaining({ method: 'POST' }));
  expect(fetch).toHaveBeenCalledWith(session, expect.objectContaining({ method: 'DELETE' }));
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers[0].postMessage).toHaveBeenLastCalledWith({ type: 'ack', offset: encryptedFileSize(5) });
});

test('an oversized upload is rejected before any encryption worker is created', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 413 }));
  await expect(uploadFiles(options())).rejects.toMatchObject({ status: 413 });
  expect(workers).toHaveLength(0);
});

test('retries the same ciphertext after a failed packet without re-encrypting it', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  let attempts = 0;
  vi.mocked(fetch).mockImplementation(async (input, init) =>
    init?.method === 'PUT' && attempts++ === 0 ? new Response(null, { status: 503 }) : original(input, init)
  );
  await uploadFiles(options());
  const packets = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(packets).toHaveLength(2);
  expect(packets[0][1]?.body).toBe(packets[1][1]?.body);
  expect(workers).toHaveLength(1);
});

test('supports either file alone or both with one completed session', async () => {
  const input = options();
  await uploadFiles({
    ...input,
    files: [...input.files, { kind: 'thumbnail', file: new File(['image'], 'thumbnail.png') }]
  });
  expect(workers).toHaveLength(2);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1);
  expect(input.onProgress).toHaveBeenLastCalledWith({ encrypted: 1, uploaded: 1 });
});

test('terminates encryption and discards partial data when cancelled', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method !== 'PUT') return original(input, init);
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    );
  });
  const controller = new AbortController();
  const running = uploadFiles(options(vi.fn(), controller));
  // noinspection JSVoidFunctionReturnValueUsed it's not void, it's promise void
  const failure = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(workers).toHaveLength(1));
  controller.abort();
  await failure;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(session, expect.objectContaining({ method: 'DELETE' }));
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false);
});

test('cleans up after encryption errors and invalid server acknowledgements', async () => {
  failWorker = true;
  await expect(uploadFiles(options())).rejects.toThrow('upload-encryption');
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(session, expect.objectContaining({ method: 'DELETE' }));
  failWorker = false;
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) =>
    init?.method === 'PUT' ? new Response(JSON.stringify({ received: 0 })) : original(input, init)
  );
  await expect(uploadFiles(options())).rejects.toThrow('upload-protocol');
});
