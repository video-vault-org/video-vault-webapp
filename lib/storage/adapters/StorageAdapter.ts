/**
 * StorageAdapter is used to abstract storage operations (save/read/delete files) away from the business logic.
 */
interface StorageAdapter {
  /**
   * saves a file
   * @param descriptor filename for file storage, object key on s3 storage
   * @param data file content as Buffer
   */
  save(descriptor: string, data: Buffer): Promise<void>;

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
   * deletes a file
   * @param descriptor filename for file storage, object key on s3 storage
   * @retuens promise with boolean, true if file/object deleted, false if not because it does not exist
   */
  delete(descriptor: string): Promise<boolean>;
}

export { StorageAdapter };
