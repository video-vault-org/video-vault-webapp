import { encryptionPackets, pumpEncryption } from './encryptionPackets';

interface EncryptionRequest {
  type: 'encrypt';
  file: File;
  kind: 'video' | 'thumbnail';
  identity: string;
  key: CryptoKey;
  partBytes: number;
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<EncryptionRequest | { type: 'ack'; offset: number }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

let acknowledge: ((offset: number) => void) | undefined;
let running = false;

worker.onmessage = (event) => {
  if (event.data.type === 'ack') {
    acknowledge?.(event.data.offset);
    return;
  }
  if (running) return;
  running = true;
  const { file, kind, identity, key, partBytes } = event.data;
  void pumpEncryption(
    encryptionPackets(file, kind, identity, key, partBytes),
    (packet, offset) =>
      new Promise<void>((resolve, reject) => {
        const end = offset + packet.byteLength;
        acknowledge = (received) => {
          acknowledge = undefined;
          if (received === end) resolve();
          else reject(new Error('Invalid upload acknowledgement'));
        };
        worker.postMessage({ type: 'packet', offset, data: packet.buffer }, [packet.buffer]);
      }),
    (bytes) => worker.postMessage({ type: 'progress', bytes })
  ).then(
    () => worker.postMessage({ type: 'done' }),
    () => worker.postMessage({ type: 'error' })
  );
};
