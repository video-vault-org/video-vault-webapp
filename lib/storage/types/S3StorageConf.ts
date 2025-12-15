interface S3StorageConf {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export { S3StorageConf };
