import { expect, test } from 'vitest';
import { Buffer } from 'node:buffer';
import { encryptionPackets, pumpEncryption } from '../lib/encryptionPackets';
import { CHUNK, createKeys, decrypt, encryptedFileSize, layout } from '../lib/crypto';

test.each([0, 1, CHUNK, CHUNK + 1, CHUNK * 33 + 17])(
  'streams %i bytes in bounded transport packets without changing decryption or AAD',
  async (size) => {
    const keys = await createKeys();
    const original = new Uint8Array(size).fill(42);
    const packets = [];
    for await (const packet of encryptionPackets(new Blob([original]), 'video', 'v.video', keys.encryption, 8192)) {
      expect(packet.byteLength).toBeLessThanOrEqual(8192);
      packets.push(packet);
    }
    const encrypted = new Blob(packets);
    expect(encrypted.size).toBe(encryptedFileSize(size));
    expect(layout(encrypted.size).length).toBe(size);
    expect(Buffer.from(await (await decrypt(encrypted, 'video', 'v.video', keys)).arrayBuffer()).equals(Buffer.from(original))).toBe(true);
    await expect(decrypt(encrypted, 'thumbnail', 'v.video', keys)).rejects.toThrow();
  },
  15000
);

test('keeps one upload in flight and prepares at most one following packet until it is acknowledged', async () => {
  let produced = 0,
    active = 0,
    maximum = 0;
  const acknowledgements: (() => void)[] = [];

  const packets = async function* () {
    for (let i = 0; i < 4; i++) {
      produced++;
      yield new Uint8Array([i]);
    }
  };

  const running = pumpEncryption(
    packets(),
    async (packet, offset) => {
      expect(packet[0]).toBe(offset);
    structuredClone(packet.buffer, { transfer: [packet.buffer] });
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => acknowledgements.push(resolve));
      active--;
    },
    () => {}
  );
  for (let index = 0; index < 4; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(produced).toBe(Math.min(index + 2, 4));
    expect(acknowledgements).toHaveLength(index + 1);
    acknowledgements[index]();
  }
  await running;
  expect(maximum).toBe(1);
});

test('rejects invalid packet sizes and computes multi-GiB lengths without allocating the file', async () => {
  expect(encryptedFileSize(3 * 1024 ** 3)).toBeGreaterThan(3 * 1024 ** 3);
  expect(() => encryptedFileSize(-1)).toThrow();
  const keys = await createKeys();
  for (const size of [0, 4 * 1024 ** 2 + 1]) {
    const iterator = encryptionPackets(new Blob(), 'video', 'v.video', keys.encryption, size);
    await expect(iterator.next()).rejects.toThrow('Invalid packet size');
  }
});
