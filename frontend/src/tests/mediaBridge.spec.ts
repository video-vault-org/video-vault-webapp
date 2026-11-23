import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mediaUrl, clearMedia } from '../lib/mediaBridge';
import { openMedia } from '../lib/ranges';
import { errorText } from '../lib/ui';
import type { Keys, Video } from '../lib/types';

type Port = {
  onmessage: ((event: { data: unknown }) => void) | null;
  onmessageerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

type Channel = { port1: Port; port2: object };

vi.mock('../lib/ranges', () => ({ openMedia: vi.fn() }));

const video = { videoId: 'v1', title: 'private-title', videoMimeType: 'video/mp4' } as Video;
const keys = { encryption: { secret: 'private-key' } } as unknown as Keys;
let channels: Channel[];
let controller: { state: string; postMessage: ReturnType<typeof vi.fn> } | null;
let worker: NonNullable<typeof controller>;
let service: {
  ready: Promise<unknown>;
  readonly controller: typeof controller;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let listeners: Map<string, () => void>;

beforeEach(() => {
  vi.clearAllMocks();
  channels = [];
  listeners = new Map();
  worker = { state: 'activated', postMessage: vi.fn(() => channels.at(-1)?.port1.onmessage?.({ data: 'owner' })) };
  controller = worker;
  service = {
    ready: Promise.resolve({ active: worker }),
    get controller() {
      return controller;
    },
    addEventListener: vi.fn((type: string, listener: () => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type))
  };
  vi.stubGlobal('navigator', { serviceWorker: service });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1: Port = { onmessage: null, onmessageerror: null, close: vi.fn() };
      port2 = {};
      constructor() {
        channels.push(this);
      }
    }
  );
  vi.mocked(openMedia).mockResolvedValue({ size: 100, mime: 'video/mp4', read: vi.fn() });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  clearMedia();
  vi.useRealTimers();
});

test('prepares media only after the worker handshake and clears all preparation timers', async () => {
  vi.useFakeTimers();
  const result = await mediaUrl(video, keys);
  expect(result.url).toMatch(/^\/__media\/[^/]+\/v1\/owner$/);
  expect(openMedia).toHaveBeenCalledExactlyOnceWith(video, keys);
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'vault:client' }, [channels[0].port2]);
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(console.error).not.toHaveBeenCalled();
  result.dispose();
});

test('requests takeover from an active worker before opening a file on an uncontrolled page', async () => {
  vi.useFakeTimers();
  controller = null;
  worker.postMessage.mockImplementation((message: { type: string }) => {
    if (message.type === 'vault:claim') {
      expect(openMedia).not.toHaveBeenCalled();
      expect(listeners.has('controllerchange')).toBe(true);
      listeners.get('controllerchange')!();
      expect(openMedia).not.toHaveBeenCalled();
      controller = worker;
      listeners.get('controllerchange')!();
    } else channels.at(-1)!.port1.onmessage!({ data: 'owner' });
  });
  const result = await mediaUrl(video, keys);
  expect(worker.postMessage.mock.calls.map(([message]) => message.type)).toEqual(['vault:claim', 'vault:client']);
  expect(openMedia).toHaveBeenCalledOnce();
  expect(listeners.has('controllerchange')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  result.dispose();
});

test.each(['worker-ready', 'worker-control', 'worker-client'])('reports the failing preparation step %s without requesting video data', async (stage) => {
  vi.useFakeTimers();
  if (stage === 'worker-ready') service.ready = new Promise(() => {});
  if (stage === 'worker-control') {
    controller = null;
    worker.postMessage.mockImplementation(() => {});
  }
  if (stage === 'worker-client') worker.postMessage.mockImplementation(() => {});
  const result = expect(mediaUrl(video, keys)).rejects.toThrow(stage);
  await vi.advanceTimersByTimeAsync(10000);
  await result;
  expect(openMedia).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith('Video preparation failed', expect.objectContaining({ stage, message: stage }));
  expect(listeners.has('controllerchange')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private-key|private-title/);
});

test.each([null, '', { invalid: true }])('rejects invalid worker replies before reading the file (%j)', async (data) => {
  worker.postMessage.mockImplementation(() => channels.at(-1)!.port1.onmessage!({ data }));
  await expect(mediaUrl(video, keys)).rejects.toThrow('worker-client');
  expect(openMedia).not.toHaveBeenCalled();
  expect(channels[0].port1.close).toHaveBeenCalledOnce();
});

test('reports file-open failures separately and preserves the original exception', async () => {
  const error = new TypeError('Network unavailable');
  vi.mocked(openMedia).mockRejectedValueOnce(error);
  await expect(mediaUrl(video, keys)).rejects.toBe(error);
  expect(console.error).toHaveBeenCalledWith('Video preparation failed', expect.objectContaining({ stage: 'file-open', name: 'TypeError' }));
});

test.each(['de', 'en'])('provides specific service worker messages in %s', (language) => {
  for (const stage of ['worker-ready', 'worker-control', 'worker-client']) {
    const message = errorText(new Error(stage), (de, en) => (language === 'de' ? de : en));
    expect(message).toMatch(/service worker/i);
    expect(message).not.toMatch(/Vorgang fehlgeschlagen|Operation failed/);
  }
});
