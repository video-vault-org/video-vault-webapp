import { CHUNK, WRAPPED, STRIDE, bytes, concat, layout, decryptChunk, unwrapFile } from './crypto';
import { request } from './api';
import { range } from './byteRange';
import type { Keys, Video } from './types';

const cipherRange = function (from: number, to: number, size: number) {
  const info = layout(size);
  if (from < 0 || to < from || to >= info.length) throw new RangeError('range');
  return {
    first: Math.floor(from / CHUNK),
    last: Math.floor(to / CHUNK),
    from: WRAPPED + Math.floor(from / CHUNK) * STRIDE,
    to: Math.min(size - 1, WRAPPED + (Math.floor(to / CHUNK) + 1) * STRIDE - 1)
  };
};

const openMedia = async function (video: Video, keys: Keys) {
  const path = `/api/video/file/${encodeURIComponent(video.videoId)}`;
  const head = await request(path, { method: 'HEAD' }),
    size = Number(head.headers.get('Content-Length'));
  const info = layout(size);

  const read = async function (from: number, to: number) {
    const response = await request(path, { headers: { Range: `bytes=${from}-${to}` } });
    if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${from}-${to}/${size}`)
      throw new Error('range');
    const data = bytes(await response.arrayBuffer());
    if (data.length !== to - from + 1) throw new Error('range');
    return data;
  };

  const fileKey = await unwrapFile(await read(0, 39), keys);
  return {
    size: info.length,
    mime: video.videoMimeType,

    async read(from: number, to: number) {
      const r = cipherRange(from, to, size),
        data = await read(r.from, r.to),
        parts: Uint8Array[] = [];
      for (let i = r.first; i <= r.last; i++) {
        const offset = (i - r.first) * STRIDE;
        parts.push(
          await decryptChunk(
            data.subarray(offset, Math.min(data.length, offset + STRIDE)),
            fileKey,
            'video',
            `${video.videoId}.video`,
            i,
            info.count
          )
        );
      }
      return concat(...parts).slice(from - r.first * CHUNK, to - r.first * CHUNK + 1);
    }
  };
};

export { range, cipherRange, openMedia };
