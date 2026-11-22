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
  if (!('serviceWorker' in navigator) || !isSecureContext) throw new Error('secure');
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('worker')), 10000))
  ]);
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve, reject) => {
      const listener = () => {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', listener);
        resolve();
      };

      const timeout = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', listener);
        reject(new Error('worker'));
      }, 10000);

      navigator.serviceWorker.addEventListener('controllerchange', listener);
    });
  const owner = await new Promise<string>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('worker'));
    }, 10000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };
    navigator.serviceWorker.controller!.postMessage({ type: 'vault:client' }, [channel.port2]);
  });
  const id = crypto.randomUUID();
  media.set(id, await openMedia(video, keys));
  return { url: `/__media/${id}/${video.videoId}/${owner}`, dispose: () => media.delete(id) };
};

const clearMedia = function () {
  media.clear();
};

export { installMediaBridge, mediaUrl, clearMedia };
