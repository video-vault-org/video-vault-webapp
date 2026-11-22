/**
 * StorageAdapter is used to abstract storage operations (save/read/delete files) away from the business logic.
 */
interface StorageAdapter {
  /**
   * saves a file (copies it from temporary directory into the storage)
   * @param tmpFilePath The path of the file in the temporary directory
   * @param descriptor The filename / object key for the file in the storage
   * @example save('./tmp/${videoId}.video', '${videoId}.video');
   */
  save(tmpFilePath: string, descriptor: string): Promise<void>;

  /**
   * reads a file
   * @param descriptor filename for file storage, object key on s3 storage
   * @returns promise with file content as Buffer if file/object exists, null if not
   */
  read(descriptor: string): Promise<Buffer | null>;

  /**
   * reads a range/part of a file
   * @param descriptor filename for file storage, object key on s3 storage
   * @param from byte offset the file should be read from (inclusive); if undefined, file will be read from start
   * @param to byte offset the file should be read to (inclusive); if undefined, file will be read to end
   * @returns promise with file range content as Buffer if file/object exists, null if not
   */
  readRange(descriptor: string, from?: number, to?: number): Promise<Buffer | null>;

  /**
   * Deletes a file. If it does not exist, the operation succeeds.
   * @param descriptor filename for file storage, object key on s3 storage
   */
  delete(descriptor: string): Promise<void>;

  /** Returns stored byte length without downloading the object; null if absent. */
  size(descriptor: string): Promise<number | null>;
}

export { StorageAdapter };
