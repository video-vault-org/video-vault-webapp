import {
  S3Client,
  CreateBucketCommand,
  CreateBucketCommandInput,
  GetObjectCommandInput,
  GetObjectCommand,
  PutObjectCommandInput,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { MinioContainer, StartedMinioContainer } from '@testcontainers/minio';
import { S3StorageAdapter } from '@/storage/adapters/S3StorageAdapter';

const BUCKET_NAME = 'files-crud';
let storage: S3StorageAdapter | null = null;

const createBucket = async function (): Promise<void> {
  const input: CreateBucketCommandInput = {
    Bucket: BUCKET_NAME
  };
  const command = new CreateBucketCommand(input);
  const client = storage?.getConf()[0] ?? new S3Client();
  await client.send(command);
};

const createObject = async function (client: S3Client, Key: string, Body: Buffer): Promise<void> {
  const input: PutObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key,
    Body
  };
  const command = new PutObjectCommand(input);
  await client.send(command);
};

const getBodyFromObject = async function (client: S3Client, Key: string): Promise<Buffer> {
  const input: GetObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key
  };
  const command = new GetObjectCommand(input);
  const result = await client.send(command);
  const dataArray = await result.Body?.transformToByteArray();

  return Buffer.from(dataArray ?? new Uint8Array());
};

const objectExists = async function (client: S3Client, Key: string): Promise<boolean> {
  const input: GetObjectCommandInput = {
    Bucket: BUCKET_NAME,
    Key
  };
  const command = new GetObjectCommand(input);
  try {
    const result = await client.send(command);
    return !!result.Body;
  } catch (err: unknown) {
    if ((err as Error).name === 'NoSuchKey') {
      return false;
    }
    throw err as Error;
  }
};

describe('S3StorageAdapter', (): void => {
  jest.setTimeout(60000);
  const content = Buffer.from('content', 'utf8');

  let container: null | StartedMinioContainer = null;

  beforeAll(async (): Promise<void> => {
    container = await new MinioContainer('minio/minio:RELEASE.2025-09-07T16-13-09Z').withAddedCapabilities().start();
    storage = new S3StorageAdapter({
      region: 'local',
      accessKeyId: container.getUsername(),
      secretAccessKey: container.getPassword(),
      bucket: BUCKET_NAME,
      endpoint: container.getConnectionUrl(),
      forcePathStyle: true
    });
    await createBucket();
  });

  afterAll(async (): Promise<void> => {
    container?.stop();
  });

  test('S3StorageAdapter->constructor creates client correctly.', async () => {
    const newStorage = new S3StorageAdapter({
      region: 'local',
      accessKeyId: container?.getUsername() ?? '',
      secretAccessKey: container?.getPassword() ?? '',
      bucket: BUCKET_NAME,
      endpoint: container?.getConnectionUrl() ?? '',
      forcePathStyle: true
    });

    const [client, bucket] = newStorage.getConf();
    expect(bucket).toEqual(BUCKET_NAME);
    expect(await client.config.region()).toEqual('local');
    expect((await client.config.credentials()).accessKeyId).toEqual(container?.getUsername() ?? '');
    expect((await client.config.credentials()).secretAccessKey).toEqual(container?.getPassword() ?? '');
    expect(client.config.endpoint ? (await client.config.endpoint()).hostname : '').toEqual('localhost');
    expect(client.config.forcePathStyle).toBe(true);
  });

  test('S3StorageAdapter->save saves object correctly.', async () => {
    await storage?.save('sub/obj', content);

    const body = await getBodyFromObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj');
    expect(body.toString('utf8')).toEqual(content.toString('utf8'));
  });

  test('S3StorageAdapter->read reads object correctly.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);

    const body = await storage?.read('sub/obj');

    expect(body?.toString('utf8')).toEqual(content.toString('utf8'));
  });

  test('S3StorageAdapter->read returns null if object does not exist.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);

    const body = await storage?.read('sub/nope');

    expect(body).toBeNull();
  });

  test('S3StorageAdapter->delete deletes object correctly.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2', content);

    const deleted = await storage?.delete('sub/obj');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj')).toBe(false);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2')).toBe(true);
    expect(deleted).toBe(true);
  });

  test('S3StorageAdapter->delete returns false if object does not exist.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2', content);

    const deleted = await storage?.delete('sub/nope');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj')).toBe(true);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2')).toBe(true);
    expect(deleted).toBe(false);
  });

  test('S3StorageAdapter->deleteDir deletes all objects with common prefix correctly.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2', content);

    const count = await storage?.deleteDir('sub');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj')).toBe(false);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2')).toBe(false);
    expect(count).toBe(2);
  });

  test('S3StorageAdapter->deleteDir deletes all objects with common prefix correctly, 1234 objects, so two chunks.', async () => {
    for (let i = 0; i < 1234; i++) {
      await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj' + i, content);
    }

    const count = await storage?.deleteDir('sub');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj0')).toBe(false);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj1')).toBe(false);
    expect(count).toBe(1234);
  });

  test('S3StorageAdapter->deleteDir returns 0 if no object key has this prefix.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2', content);

    const count = await storage?.deleteDir('nope');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj')).toBe(true);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2')).toBe(true);
    expect(count).toBe(0);
  });
});
