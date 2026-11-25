import { ApiError, request } from './api';
import { encryptedFileSize } from './crypto';

interface UploadFile {
  kind: 'video' | 'thumbnail';
  file: File;
}

interface UploadProgress {
  encrypted: number;
  uploaded: number;
}

interface WorkerMessage {
  type: 'packet' | 'progress' | 'done' | 'error';
  offset?: number;
  data?: ArrayBuffer;
  bytes?: number;
}

/** Retries the same encrypted bytes, never re-encrypting a failed packet. */
const retryUploadRequest = async function (action: () => Promise<Response>, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      const retryable =
        error instanceof TypeError || (error instanceof ApiError && (error.status >= 500 || error.status === 409));
      if (signal.aborted || !retryable || attempt >= 2) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          300 * (attempt + 1)
        );
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
};

/** Encrypts in a worker with one packet in flight and at most one packet being prepared ahead. */
const uploadFiles = async function ({
  videoId,
  files,
  key,
  signal,
  onProgress
}: {
  videoId: string;
  files: UploadFile[];
  key: CryptoKey;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
}): Promise<void> {
  const sizes = files.map(({ kind, file }) => ({ kind, size: encryptedFileSize(file.size) }));
  const total = sizes.reduce((sum, file) => sum + file.size, 0);
  const base = `/api/video/upload/${videoId}`;
  onProgress({ encrypted: 0, uploaded: 0 });
  const response = await request(`${base}/start`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: sizes })
  });
  const { uploadId, maxPartBytes } = (await response.json()) as { uploadId: string; maxPartBytes: number };
  let uploaded = 0,
    encrypted = 0,
    previousFiles = 0;
  const report = () => onProgress({ encrypted: encrypted / total, uploaded: uploaded / total });
  const session = `${base}/${uploadId}`;
  try {
    for (const { kind, file } of files) {
      const worker = new Worker(new URL('./upload.worker.ts', import.meta.url), { type: 'module' });
      try {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(new DOMException('Upload aborted', 'AbortError'));
          signal.addEventListener('abort', abort, { once: true });
          const finish = (error?: unknown) => {
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve();
          };
          worker.onerror = () => finish(new Error('upload-encryption'));
          worker.onmessageerror = () => finish(new Error('upload-encryption'));
          worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
            const message = event.data;
            if (message.type === 'progress') {
              encrypted = Math.max(encrypted, previousFiles + message.bytes!);
              report();
            } else if (message.type === 'done') finish();
            else if (message.type === 'error') finish(new Error('upload-encryption'));
            else if (message.type === 'packet') {
              const { data, offset } = message as { data: ArrayBuffer; offset: number };
              void retryUploadRequest(
                () =>
                  request(`${session}/${kind}?offset=${offset}`, {
                    method: 'PUT',
                    signal,
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: data
                  }),
                signal
              )
                .then(async (response) => {
                  const { received } = (await response.json()) as { received: number };
                  if (received !== offset + data.byteLength) throw new Error('upload-protocol');
                  uploaded = previousFiles + received;
                  report();
                  worker.postMessage({ type: 'ack', offset: received });
                })
                .catch(finish);
            }
          };
          if (signal.aborted) {
            finish(new DOMException('Upload aborted', 'AbortError'));
            return;
          }
          worker.postMessage({
            type: 'encrypt',
            file,
            kind,
            identity: `${videoId}.${kind}`,
            key,
            partBytes: maxPartBytes
          });
        });
      } finally {
        worker.terminate();
      }
      previousFiles += encryptedFileSize(file.size);
    }
    await retryUploadRequest(() => request(`${session}/complete`, { method: 'POST', signal }), signal);
  } finally {
    // This removes partial data after failure, or only session metadata after successful completion.
    const cleanup = new AbortController();
    const timeout = setTimeout(() => cleanup.abort(), 5000);
    try {
      await request(session, { method: 'DELETE', signal: cleanup.signal }).catch(() => undefined);
    } finally {
      clearTimeout(timeout);
    }
  }
};

export { uploadFiles };
