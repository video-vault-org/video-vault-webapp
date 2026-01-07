import { readFile, writeFile, mkdir } from 'fs/promises';
import express from 'express';
import request from 'supertest';
import { buildConfigApi } from '@/server/api/configApi';
import { deleteDirectory, exists } from '#/util';
import { StorageConfig } from '@/storage/types/StorageConfig';
import { User } from '@/user/types/User';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { AuthorizedInitRequest } from '@/server/types/AuthorizedInitRequest';
import { DatabaseConfig } from '@/db/types/DatabaseConfig';
import { FrontendConfig } from '@/frontend/types/FrontendConfig';

describe('api - config', () => {
  const testUser: User = {
    userId: 'testUserId',
    username: 'testName',
    displayName: 'testDisplayName',
    passwordKeySalt: 'testSalt',
    userKey: 'testKey',
    hash: 'testHash',
    hashSalt: 'testSalt',
    hashAlgorithm: 'testAlgo',
    userManager: true,
    videoManager: false,
    admin: true
  };

  const buildApi = function (admin: boolean, init: boolean) {
    const configApi = buildConfigApi();
    const api = express();
    api.use(async (req, _, next) => {
      if (init) {
        (req as AuthorizedInitRequest).authorizedInit = true;
      }
      (req as AuthorizedUserRequest).authorizedUser = { ...testUser, admin };
      next();
    });
    api.use(express.json());
    api.use('/config', configApi);
    return api;
  };

  afterEach(async () => {
    await deleteDirectory('./conf');
  });

  describe('adminHandler', () => {
    test('calls next if user is admin.', async () => {
      const api = buildApi(true, false);
      api.post('/config/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/config/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('calls next if init.', async () => {
      const api = buildApi(false, true);
      api.post('/config/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/config/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('responses error if user is not video manager.', async () => {
      const api = buildApi(false, false);
      api.post('/config/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/config/manage/test');

      expect(response.status).toBe(403);
      expect(response.body?.error).toEqual('forbidden');
    });
  });

  describe('saveConfigHandlers', () => {
    test('saveStorageConfigHandlers saves config successfully.', async () => {
      const api = buildApi(true, false);
      const config: StorageConfig = { type: 'local', conf: { basePath: './files' } };

      const response = await request(api).post('/config/manage/save-storage').send({ config });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('saved');
      expect(await exists('./conf/storage.json')).toBe(true);
      expect(await readFile('./conf/storage.json')).toEqual(Buffer.from(JSON.stringify(config), 'utf8'));
    });

    test('saveDatabaseConfigHandlers saves config successfully.', async () => {
      const api = buildApi(true, false);
      const config: DatabaseConfig = { type: 'in-memory' };

      const response = await request(api).post('/config/manage/save-database').send({ config });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('saved');
      expect(await exists('./conf/db.json')).toBe(true);
      expect(await readFile('./conf/db.json')).toEqual(Buffer.from(JSON.stringify(config), 'utf8'));
    });

    test('saveFrontendConfigHandlers saves config successfully.', async () => {
      const api = buildApi(true, false);
      const config: FrontendConfig = { logo: 'l', title: 't', description: 'd', videoMeta: [{ type: 'string', name: 'metaN', encrypted: false }] };

      const response = await request(api).post('/config/manage/save-frontend').send({ config });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('saved');
      expect(await exists('./conf/frontend.json')).toBe(true);
      expect(await readFile('./conf/frontend.json')).toEqual(Buffer.from(JSON.stringify(config), 'utf8'));
    });
  });

  describe('loadConfigHandlers', () => {
    test('loadStorageConfigHandlers saves config successfully.', async () => {
      const api = buildApi(false, false);
      const config: StorageConfig = { type: 'local', conf: { basePath: './files' } };
      await mkdir('./conf', { recursive: true });
      await writeFile('./conf/storage.json', Buffer.from(JSON.stringify(config), 'utf8'));

      const response = await request(api).get('/config/load-storage');

      expect(response.status).toBe(200);
      expect(response.body.config).toEqual(config);
    });

    test('loadDatabaseConfigHandlers saves config successfully.', async () => {
      const api = buildApi(false, false);
      const config: DatabaseConfig = { type: 'in-memory' };
      await mkdir('./conf', { recursive: true });
      await writeFile('./conf/db.json', Buffer.from(JSON.stringify(config), 'utf8'));

      const response = await request(api).get('/config/load-database');

      expect(response.status).toBe(200);
      expect(response.body.config).toEqual(config);
    });

    test('loadFrontendConfigHandlers saves config successfully.', async () => {
      const api = buildApi(false, false);
      const config: FrontendConfig = { logo: 'l', title: 't', description: 's', videoMeta: [{ type: 'string', name: 'metaN', encrypted: false }] };
      await mkdir('./conf', { recursive: true });
      await writeFile('./conf/frontend.json', Buffer.from(JSON.stringify(config), 'utf8'));

      const response = await request(api).get('/config/load-frontend');

      expect(response.status).toBe(200);
      expect(response.body.config).toEqual(config);
    });
  });
});
