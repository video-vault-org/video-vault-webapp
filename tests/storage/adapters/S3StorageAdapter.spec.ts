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
    storage = new S3StorageAdapter('local', container.getUsername(), container.getPassword(), BUCKET_NAME, container.getConnectionUrl(), true);
    await createBucket();
  });

  afterAll(async (): Promise<void> => {
    container?.stop();
  });

  test('S3StorageAdapter->constructor creates client correctly.', async () => {
    const newStorage = new S3StorageAdapter(
      'local',
      container?.getUsername() ?? '',
      container?.getPassword() ?? '',
      BUCKET_NAME,
      container?.getConnectionUrl() ?? '',
      true
    );

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

  test('S3StorageAdapter->read throws error if object does not exist.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    let error: Error | null = null;

    try {
      await storage?.read('sub/obj2');
    } catch (err: unknown) {
      error = err as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toEqual('Error: object not found: sub/obj2');
  });

  test('S3StorageAdapter->delete deletes object correctly.', async () => {
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj', content);
    await createObject(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2', content);

    await storage?.delete('sub/obj');

    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj')).toBe(false);
    expect(await objectExists(storage?.getConf()[0] ?? new S3Client(), 'sub/obj2')).toBe(true);
  });
});
