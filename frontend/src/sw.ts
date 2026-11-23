/// <reference lib="webworker" />
import { range } from './lib/byteRange';

const sw = self as unknown as ServiceWorkerGlobalScope,
  cacheName = `vault-shell-${__BUILD_ID__}-__VIDEOVAULT_IMAGES_VERSION__`;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const paths = await (await fetch('/precache.json', { cache: 'no-store' })).json();
      const cache = await caches.open(cacheName);
      await cache.addAll(paths.map((path: string) => new Request(path, { cache: 'reload' })));
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('vault-shell-') && name !== cacheName) await caches.delete(name);
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'vault:claim') {
    event.waitUntil(sw.clients.claim());
    return;
  }
  if (event.data?.type === 'vault:client' && event.source && 'id' in event.source)
    event.ports[0]?.postMessage(event.source.id);
});

const ask = function (
  client: Client,
  payload: Record<string, unknown>
): Promise<{ size: number; mime: string; data: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(),
      timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Client unavailable'));
      }, 30000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data.error) reject(new Error('Media unavailable'));
      else resolve(event.data);
    };
    client.postMessage({ type: 'vault:range', ...payload }, [channel.port2]);
  });
};

const media = async function (event: FetchEvent): Promise<Response> {
  const owner = new URL(event.request.url).pathname.split('/')[4];
  const client = await sw.clients.get(owner || event.clientId || '');
  if (!client) return new Response(null, { status: 401 });
  try {
    const url = event.request.url,
      info = await ask(client, { url, info: true });
    if (!info.size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */0' } });
    let start: number, end: number;
    try {
      [start, end] = range(event.request.headers.get('Range'), info.size);
    } catch {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    }
    const ranged = event.request.headers.has('Range'),
      download = new URL(url).searchParams.has('download');
    let offset = start,
      cancelled = false;
    const stream = new ReadableStream(
      {
        async pull(controller) {
          if (cancelled) return;
          try {
            if (offset > end) {
              controller.close();
              return;
            }
            const to = Math.min(end, offset + 1024 * 1024 - 1),
              result = await ask(client, { url, from: offset, to });
            if (cancelled) return;
            controller.enqueue(result.data);
            offset = to + 1;
          } catch (error) {
            if (!cancelled) controller.error(error);
          }
        },

        cancel() {
          cancelled = true;
        }
      },
      { highWaterMark: 1 }
    );
    return new Response(event.request.method === 'HEAD' ? null : stream, {
      status: ranged ? 206 : 200,
      headers: {
        'Content-Type': /^[\w.+-]+\/[\w.+-]+(?:;[^\r\n]*)?$/.test(info.mime) ? info.mime : 'application/octet-stream',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        ...(ranged ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
        ...(download
          ? {
              'Content-Disposition': `attachment; filename="${info.mime === 'video/mp4' ? 'video.mp4' : info.mime === 'video/webm' ? 'video.webm' : 'video.bin'}"`
            }
          : {})
      }
    });
  } catch {
    return new Response(null, { status: 503 });
  }
};

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/__media/')) {
    event.respondWith(media(event));
    return;
  }
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/login' ||
    url.pathname === '/bootstrap'
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName),
        cached = await cache.match(
          event.request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : event.request
        );
      if (cached) return cached;
      return fetch(event.request);
    })()
  );
});
