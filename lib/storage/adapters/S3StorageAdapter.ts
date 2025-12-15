import {
  S3Client,
  S3ClientConfig,
  PutObjectCommandInput,
  PutObjectCommand,
  GetObjectCommand,
  GetObjectCommandInput,
  DeleteObjectCommand,
  DeleteObjectCommandInput
} from '@aws-sdk/client-s3';
import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { S3StorageConf } from '@/storage/types/S3StorageConf';

/**
 * Storage Adapter for S3 (and compatible services)
 */
class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  public constructor({ region, accessKeyId, secretAccessKey, bucket, endpoint, forcePathStyle }: S3StorageConf) {
    const conf: S3ClientConfig = { region, forcePathStyle, credentials: { accessKeyId, secretAccessKey } };
    if (!!endpoint) {
      conf.endpoint = endpoint;
    }
    this.client = new S3Client(conf);
    this.bucket = bucket;
  }

  public getConf(): [S3Client, string] {
    return [this.client, this.bucket];
  }

  public async save(descriptor: string, data: Buffer): Promise<void> {
    const commandInput: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: descriptor,
      Body: data
    };
    const command = new PutObjectCommand(commandInput);
    await this.client.send(command);
  }

  public async read(descriptor: string): Promise<Buffer> {
    const commandInput: GetObjectCommandInput = {
      Bucket: this.bucket,
      Key: descriptor
    };
    const command = new GetObjectCommand(commandInput);
    let dataArray: Uint8Array | undefined = undefined;

    try {
      const result = await this.client.send(command);
      dataArray = await result.Body?.transformToByteArray();
    } catch (error: unknown) {
      if ((error as Error).message !== 'The specified key does not exist.') {
        throw error as Error;
      }
    }

    if (!dataArray) {
      throw new Error(`Error: object not found: ${descriptor}`);
    }

    return Buffer.from(dataArray);
  }

  public async delete(descriptor: string): Promise<void> {
    const commandInput: DeleteObjectCommandInput = {
      Bucket: this.bucket,
      Key: descriptor
    };
    const command = new DeleteObjectCommand(commandInput);
    await this.client.send(command);
  }
}

export { S3StorageAdapter };
