import { LocalStorageConf } from '@/storage/types/LocalStorageConf';
import { S3StorageConf } from '@/storage/types/S3StorageConf';

interface StorageConfigLocal {
  type: 'local';
  conf: LocalStorageConf;
}

interface StorageConfigS3 {
  type: 's3';
  conf: S3StorageConf;
}

type StorageConfig = StorageConfigLocal | StorageConfigS3;

export { StorageConfig };
