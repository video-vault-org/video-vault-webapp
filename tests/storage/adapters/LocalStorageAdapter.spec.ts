import { LocalStorageAdapter } from '@/storage/adapters/LocalStorageAdapter';
import mockFS from 'mock-fs';
import fs from 'fs/promises';
import { exists } from '#/util';

describe('LocalStorageAdapter', (): void => {
  const storage = new LocalStorageAdapter({ basePath: '/opt/video-vault/files' });

  afterEach(async (): Promise<void> => {
    mockFS.restore();
  });

  test('LocalStorageAdapter->constructor sets basePath correctly.', async (): Promise<void> => {
    const newStorage = new LocalStorageAdapter({ basePath: '/given' });

    expect(newStorage.getBasePath()).toBe('/given');
  });

  test('LocalStorageAdapter->save creates needed directories and saves file.', async (): Promise<void> => {
    const content = Buffer.from('content', 'utf8');
    mockFS({ '/opt/video-vault/files': {} });

    await storage.save('sub/file', content);

    expect(await exists('/opt/video-vault/files/sub/file')).toBe(true);
    expect(await fs.readFile('/opt/video-vault/files/sub/file')).toEqual(content);
  });

  test('LocalStorageAdapter->read reads file.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files/sub': {
        file: 'content'
      }
    });

    const content = await storage.read('sub/file');

    expect(content?.toString('utf8')).toEqual('content');
  });

  test('LocalStorageAdapter->read returns null if file does not exist.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files/sub': {
        file: 'content'
      }
    });

    const content = await storage.read('sub/nope');

    expect(content).toBeNull();
  });

  test('LocalStorageAdapter->delete deletes file, but keeps non-empty directory.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {
        subDir: {
          file: 'content',
          file2: 'content2'
        }
      }
    });

    const deleted = await storage.delete('subDir/file');

    expect(await exists('/opt/video-vault/files/subDir/file')).toBe(false);
    expect(await exists('/opt/video-vault/files/subDir/file2')).toBe(true);
    expect(deleted).toBe(true);
  });

  test('LocalStorageAdapter->delete deletes file and deletes empty directory.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {}
    });
    await fs.mkdir('/opt/video-vault/files/subDir');
    await fs.writeFile('/opt/video-vault/files/subDir/file', Buffer.from('content', 'utf8'));

    const deleted = await storage.delete('subDir/file');

    expect(await exists('/opt/video-vault/files/subDir')).toBe(false);
    expect(await exists('/opt/video-vault/files')).toBe(true);
    expect(deleted).toBe(true);
  });

  test('LocalStorageAdapter->delete returns false if file does not exist.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {
        subDir: {
          file: 'content',
          file2: 'content2'
        }
      }
    });

    const deleted = await storage.delete('subDir/nope');

    expect(await exists('/opt/video-vault/files/subDir/file')).toBe(true);
    expect(await exists('/opt/video-vault/files/subDir/file2')).toBe(true);
    expect(deleted).toBe(false);
  });

  test('LocalStorageAdapter->deleteDir deletes Dir.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {
        subDir: {
          file: 'content',
          file2: 'content2'
        }
      }
    });

    const count = await storage.deleteDir('subDir');

    expect(await exists('/opt/video-vault/files/subDir')).toBe(false);
    expect(await exists('/opt/video-vault/files/subDir/file')).toBe(false);
    expect(await exists('/opt/video-vault/files/subDir/file2')).toBe(false);
    expect(count).toBe(2);
  });

  test('LocalStorageAdapter->deleteDir returns 0 if dir does not exist.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {
        subDir: {
          file: 'content',
          file2: 'content2'
        }
      }
    });

    const count = await storage.deleteDir('nope');

    expect(await exists('/opt/video-vault/files/subDir/file')).toBe(true);
    expect(await exists('/opt/video-vault/files/subDir/file2')).toBe(true);
    expect(count).toBe(0);
  });

  test('LocalStorageAdapter->deleteDir returns 0 if dir is empty.', async (): Promise<void> => {
    mockFS({
      '/opt/video-vault/files': {
        subDir: {}
      }
    });

    const count = await storage.deleteDir('subDir');

    expect(await exists('/opt/video-vault/files/subDir')).toBe(false);
    expect(count).toBe(0);
  });
});
