import { openMedia } from './ranges';
import type { Keys, Video } from './types';

const media = new Map<string, Awaited<ReturnType<typeof openMedia>>>();

const installMediaBridge = function () {
  const handler = async (event: MessageEvent) => {
    if (event.data?.type !== 'vault:range' || !event.ports[0]) return;
    const port = event.ports[0];
    try {
      const path = new URL(event.data.url).pathname.split('/'),
        item = media.get(path[2]);
      if (!item) throw new Error('locked');
      if (event.data.info) {
        port.postMessage({ size: item.size, mime: item.mime });
        return;
      }
      const data = await item.read(event.data.from, event.data.to);
      port.postMessage({ data }, [data.buffer]);
    } catch {
      port.postMessage({ error: true });
    }
  };

  navigator.serviceWorker?.addEventListener('message', handler);

  return () => {
    navigator.serviceWorker?.removeEventListener('message', handler);
    media.clear();
  };
};

const mediaUrl = async function (video: Video, keys: Keys) {
  let stage = 'worker-ready';
  try {
    if (!('serviceWorker' in navigator) || !isSecureContext) throw new Error('secure');
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    let registration: ServiceWorkerRegistration;
    try {
      registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => {
          readyTimeout = setTimeout(() => reject(new Error('worker-ready')), 10000);
        })
      ]);
    } finally {
      if (readyTimeout !== undefined) clearTimeout(readyTimeout);
    }
    stage = 'worker-control';
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve, reject) => {
        const listener = function () {
          if (!navigator.serviceWorker.controller) return;
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', listener);
          resolve();
        };

        const timeout = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', listener);
          reject(new Error('worker-control'));
        }, 10000);

        navigator.serviceWorker.addEventListener('controllerchange', listener);
        try {
          // An active registration may exist without controlling this document (e.g. a bypass reload).
          registration.active?.postMessage({ type: 'vault:claim' });
        } catch (error) {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', listener);
          reject(error);
        }
      });
    stage = 'worker-client';
    const owner = await new Promise<string>((resolve, reject) => {
      const channel = new MessageChannel();
      const fail = function () {
        clearTimeout(timeout);
        channel.port1.close();
        reject(new Error('worker-client'));
      };
      const timeout = setTimeout(fail, 10000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        if (typeof event.data !== 'string' || !event.data) reject(new Error('worker-client'));
        else resolve(event.data);
      };
      channel.port1.onmessageerror = fail;
      try {
        navigator.serviceWorker.controller!.postMessage({ type: 'vault:client' }, [channel.port2]);
      } catch (error) {
        clearTimeout(timeout);
        channel.port1.close();
        reject(error);
      }
    });
    stage = 'file-open';
    const id = crypto.randomUUID();
    media.set(id, await openMedia(video, keys));
    return { url: `/__media/${id}/${video.videoId}/${owner}`, dispose: () => media.delete(id) };
  } catch (error) {
    // Do not log video metadata, credentials, keys or message payloads.
    console.error('Video preparation failed', {
      stage,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : 'Unknown error',
      controllerState: navigator.serviceWorker?.controller?.state ?? null
    });
    throw error;
  }
};

const clearMedia = function () {
  media.clear();
};

export { installMediaBridge, mediaUrl, clearMedia };
