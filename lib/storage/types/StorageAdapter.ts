/**
 * StorageAdapter is used to abstract storage operations (save/read/delete files) away from the business logic.
 */
interface StorageAdapter {
  /**
   * saves a file
   * @param descriptor relative file path for local storage, object key on s3 storage
   * @param data file content as Buffer
   */
  save(descriptor: string, data: Buffer): Promise<void>;

  /**
   * reads a file
   * @param descriptor relative file path for local storage, object key on s3 storage
   * @returns promise with file content as Buffer
   */
  read(descriptor: string): Promise<Buffer>;

  /**
   * deletes a file
   * @param descriptor relative file path for local storage, object key on s3 storage
   */
  delete(descriptor: string): Promise<void>;
}

export { StorageAdapter };
