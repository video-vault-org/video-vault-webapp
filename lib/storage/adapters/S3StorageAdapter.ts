import {
  S3Client,
  S3ClientConfig,
  PutObjectCommandInput,
  PutObjectCommand,
  GetObjectCommand,
  GetObjectCommandInput,
  ListObjectsV2Command,
  ListObjectsV2CommandInput,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  DeleteObjectsCommand,
  DeleteObjectsCommandInput
} from '@aws-sdk/client-s3';
import { StorageAdapter } from '@/storage/types/StorageAdapter';
import { S3StorageConf } from '@/storage/types/S3StorageConf';

const chunkKeys = function (keys: string[]): string[][] {
  const chunks: string[][] = [];
  while (keys.length > 0) {
    const chunk = keys.slice(0, 1000);
    chunks.push(chunk);
    keys.splice(0, chunk.length);
  }
  return chunks;
};

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
      return null;
    }

    return Buffer.from(dataArray);
  }

  public async delete(descriptor: string): Promise<boolean> {
    const buffer = await this.read(descriptor);
    if (!buffer) {
      return false;
    }
    const commandInput: DeleteObjectCommandInput = {
      Bucket: this.bucket,
      Key: descriptor
    };
    const command = new DeleteObjectCommand(commandInput);
    await this.client.send(command);
    return true;
  }

  public async deleteDir(descriptor: string): Promise<number> {
    const keys = await this.getAllCommonPrefixKeys(descriptor.replace(/\\$/, '') + '/');
    const count = keys.length;

    const chunks = chunkKeys(keys);
    for (const chunk of chunks) {
      const deleteCommandInput: DeleteObjectsCommandInput = {
        Bucket: this.bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true
        }
      };
      const deleteCommand = new DeleteObjectsCommand(deleteCommandInput);
      await this.client.send(deleteCommand);
    }

    return count;
  }

  private async getAllCommonPrefixKeys(Prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const commandInput: ListObjectsV2CommandInput = {
        Bucket: this.bucket,
        Prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      };
      const command = new ListObjectsV2Command(commandInput);
      const response = await this.client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }
}

export { S3StorageAdapter };
