import { LocalStorageConf } from './LocalStorageConf';
import { S3StorageConf } from './S3StorageConf';

interface StorageConfigInMemory {
  type: 'in-memory';
}

interface StorageConfigLocal {
  type: 'local';
  conf: LocalStorageConf;
}

interface StorageConfigS3 {
  type: 's3';
  conf: S3StorageConf;
}

type StorageConfig = StorageConfigLocal | StorageConfigS3 | StorageConfigInMemory;

export { StorageConfig };
