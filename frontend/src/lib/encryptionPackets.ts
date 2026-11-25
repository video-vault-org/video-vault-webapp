import { encryptChunks } from './crypto';
import type { Keys } from './types';

/** Bounded transport packets; transport boundaries do not change the authenticated encryption chunks. */
const encryptionPackets = async function* (
  file: Blob,
  kind: 'video' | 'thumbnail',
  identity: string,
  key: Keys['encryption'],
  partBytes: number
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(partBytes) || partBytes < 1 || partBytes > 4 * 1024 ** 2)
    throw new RangeError('Invalid packet size');
  let packet = new Uint8Array(partBytes),
    used = 0;
  for await (const chunk of encryptChunks(file, kind, identity, { encryption: key })) {
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(partBytes - used, chunk.length - offset);
      packet.set(chunk.subarray(offset, offset + count), used);
      used += count;
      offset += count;
      if (used === partBytes) {
        yield packet;
        packet = new Uint8Array(partBytes);
        used = 0;
      }
    }
  }
  if (used) yield packet.slice(0, used);
};

/** One packet can be uploading while the generator prepares the next. No unbounded request queue. */
const pumpEncryption = async function (
  packets: AsyncIterable<Uint8Array<ArrayBuffer>>,
  send: (packet: Uint8Array<ArrayBuffer>, offset: number) => Promise<void>,
  progress: (bytes: number) => void
): Promise<void> {
  let pending: Promise<void> = Promise.resolve(),
    offset = 0;
  try {
    for await (const packet of packets) {
      progress(offset + packet.byteLength);
      await pending;
      const length = packet.byteLength;
      pending = send(packet, offset);
      // Register a rejection handler immediately while the next packet is being encrypted.
      void pending.catch(() => {});
      offset += length;
    }
    await pending;
  } finally {
    await pending;
  }
};

export { encryptionPackets, pumpEncryption };
