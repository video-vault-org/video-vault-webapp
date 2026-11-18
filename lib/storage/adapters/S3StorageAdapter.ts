import { S3Client, S3ClientConfig, PutObjectCommandInput, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectCommandInput } from '@aws-sdk/client-s3';
import { StorageAdapter } from './StorageAdapter';
import { S3StorageConf } from '@/storage/config/S3StorageConf';

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

  public async read(descriptor: string): Promise<Buffer | null> {
    return await this.readObject(descriptor);
  }

  public async readRange(descriptor: string, from?: number, to?: number): Promise<Buffer | null> {
    return await this.readObject(descriptor, from, to);
  }

  public async delete(descriptor: string): Promise<void> {
    const commandInput: DeleteObjectCommandInput = {
      Bucket: this.bucket,
      Key: descriptor
    };
    const command = new DeleteObjectCommand(commandInput);
    await this.client.send(command);
  }

  private async readObject(descriptor: string, from?: number, to?: number): Promise<Buffer | null> {
    let range: string | undefined;

    if (from !== undefined || to !== undefined) {
      const start = from ?? 0;

      if (!Number.isSafeInteger(start) || start < 0 || (to !== undefined && (!Number.isSafeInteger(to) || to < start))) {
        throw new RangeError('Invalid byte range');
      }

      range = `bytes=${start}-${to ?? ''}`;
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: descriptor,
          Range: range
        })
      );

      const data = await result.Body?.transformToByteArray();

      return data ? Buffer.from(data) : null;
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound' || ('$metadata' in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404))) {
        return null;
      }

      throw error;
    }
  }
}

export { S3StorageAdapter };
