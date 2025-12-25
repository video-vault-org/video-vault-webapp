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
   * @returns promise with file content as Buffer if file/object exists, null if not
   */
  read(descriptor: string): Promise<Buffer | null>;

  /**
   * deletes a file
   * @param descriptor relative file path for local storage, object key on s3 storage
   * @retuens promise with boolean, true if file/object deleted, false if not because it does not exist
   */
  delete(descriptor: string): Promise<boolean>;

  /**
   * deletes a directory (local) or all objects with equally prefixed key (s3).
   * @param descriptor directory name (local) or prefix (s3)
   * @returns promise with number of deleted files/objects (0 if directory does not exist or is empty)
   */
  deleteDir(descriptor: string): Promise<number>;
}

export { StorageAdapter };
