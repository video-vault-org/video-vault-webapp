import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, StartedMinioContainer } from '@testcontainers/minio';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';

describe('S3StorageAdapter', () => {
  jest.setTimeout(120_000);

  const bucket = 'video-vault-tests';
  const region = 'us-east-1';
  const bytes = Buffer.from([0, 127, 128, 255, 42]);
  let directory: string;
  let container: StartedMinioContainer | undefined;
  let adapter: S3StorageAdapter;
  let client: S3Client | undefined;

  async function save(descriptor: string, data: Buffer): Promise<void> {
    const source = join(directory, 'upload.tmp');
    await writeFile(source, data);
    await adapter.save(source, descriptor);
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'video-vault-s3-storage-'));
    container = await new MinioContainer('pgsty/silo:RELEASE.2026-11-12T00-00-00Z').withUsername('storage-test').withPassword('storage-test-password').start();
    adapter = new S3StorageAdapter({
      bucket,
      region,
      endpoint: container.getConnectionUrl(),
      forcePathStyle: true,
      accessKeyId: container.getUsername(),
      secretAccessKey: container.getPassword()
    });
    [client] = adapter.getConf();
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    client?.destroy();
    await container?.stop();
    await rm(directory, { recursive: true, force: true });
  });

  test('size reads object metadata from MinIO for missing, empty, overwritten and deleted objects', async () => {
    const descriptor = 'size.bin';
    expect(await adapter.size(descriptor)).toBeNull();
    await save(descriptor, Buffer.alloc(0));
    expect(await adapter.size(descriptor)).toBe(0);
    await save(descriptor, bytes);
    expect(await adapter.size(descriptor)).toBe(bytes.length);
    await adapter.delete(descriptor);
    expect(await adapter.size(descriptor)).toBeNull();
  });

  test('getConf returns the S3 client and configured bucket', async () => {
    const [configuredClient, configuredBucket] = adapter.getConf();

    expect(configuredClient).toBeInstanceOf(S3Client);
    expect(configuredBucket).toBe(bucket);
    expect(await configuredClient.config.region()).toBe(region);
    expect(configuredClient.config.forcePathStyle).toBe(true);
  });

  test('save writes binary data under a prefixed key and overwrites it', async () => {
    const key = 'videos/save.bin';
    const [s3] = adapter.getConf();
    const readObject = async () => {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await result.Body!.transformToByteArray());
    };

    await save(key, bytes);
    expect(await readObject()).toEqual(bytes);

    const replacement = Buffer.from([9, 0]);
    await save(key, replacement);
    expect(await readObject()).toEqual(replacement);
  });

  test('save uploads a file larger than one multipart part', async () => {
    const data = Buffer.alloc(6 * 1024 * 1024, 42);
    data[0] = 0;
    data[data.length - 1] = 255;

    await save('videos/multipart.bin', data);

    expect((await adapter.read('videos/multipart.bin'))?.equals(data)).toBe(true);
  });

  test('save rejects a missing source without overwriting an existing object', async () => {
    const key = 'videos/missing-source.bin';
    await save(key, bytes);

    await expect(adapter.save(join(directory, 'missing.tmp'), key)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await adapter.read(key)).toEqual(bytes);
  });

  test('read returns exact bytes for an object written through S3', async () => {
    const key = 'videos/read.bin';
    const [s3] = adapter.getConf();
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));

    expect(await adapter.read(key)).toEqual(bytes);
  });

  test('read returns null for a missing key and a buffer for an empty object', async () => {
    await save('read-empty', Buffer.alloc(0));

    expect(await adapter.read('read-missing')).toBeNull();
    expect(await adapter.read('read-empty')).toEqual(Buffer.alloc(0));
  });

  describe('readRange', () => {
    const key = 'videos/ranges.bin';

    beforeAll(async () => {
      if (client) {
        await save(key, bytes);
      }
    });

    test.each([
      [1, 3, bytes.subarray(1, 4)],
      [2, 2, bytes.subarray(2, 3)],
      [2, undefined, bytes.subarray(2)],
      [undefined, 0, bytes.subarray(0, 1)],
      [undefined, undefined, bytes]
    ])('returns inclusive bytes from %s to %s', async (from, to, expected) => {
      expect(await adapter.readRange(key, from, to)).toEqual(expected);
    });

    test.each([
      [-1, 2],
      [0.5, 2],
      [0, 1.5],
      [3, 2]
    ])('rejects invalid bounds from %s to %s', async (from, to) => {
      await expect(adapter.readRange(key, from, to)).rejects.toThrow(RangeError);
    });

    test('returns null for a missing key', async () => {
      expect(await adapter.readRange('range-missing', 0, 1)).toBeNull();
    });

    test('lets the S3 server truncate the end offset to the object size', async () => {
      expect(await adapter.readRange(key, 2, 99)).toEqual(bytes.subarray(2));
    });

    test('propagates an unsatisfiable range from the S3 server', async () => {
      await expect(adapter.readRange(key, bytes.length)).rejects.toMatchObject({ $metadata: { httpStatusCode: 416 } });
    });
  });

  test('delete removes an empty object and succeeds if repeated', async () => {
    const key = 'delete-empty';
    await save(key, Buffer.alloc(0));

    await expect(adapter.delete(key)).resolves.toBeUndefined();
    expect(await adapter.read(key)).toBeNull();
    await expect(adapter.delete(key)).resolves.toBeUndefined();
  });
});

// Metadata unit tests deliberately do not start a container.
describe('S3StorageAdapter size metadata', () => {
  afterEach(() => jest.restoreAllMocks());
  test('uses HeadObject, recognizes 404 and propagates other failures', async () => {
    const adapter = new S3StorageAdapter({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' }),
      [client] = adapter.getConf();
    const send = jest.spyOn(client, 'send').mockImplementation(async () => ({ ContentLength: 123 }) as never);
    expect(await adapter.size('v.video')).toBe(123);
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect((send.mock.calls[0][0] as HeadObjectCommand).input).toEqual({ Bucket: 'bucket', Key: 'v.video' });
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } } as never);
    expect(await adapter.size('missing')).toBeNull();
    const error = new Error('denied');
    send.mockRejectedValueOnce(error as never);
    await expect(adapter.size('v.video')).rejects.toBe(error);
    client.destroy();
  });
});
