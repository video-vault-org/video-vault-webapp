import express, { Express } from 'express';
import {
  adminHandler,
  loadDatabaseConfigHandler,
  loadFrontendConfigHandler,
  loadStorageConfigHandler,
  saveDatabaseConfigHandler,
  saveFrontendConfigHandler,
  saveStorageConfigHandler
} from '@/server/handler/configHandler';

const buildConfigApi = function (): Express {
  const api = express();
  api.use('/manage', adminHandler);
  api.post('/manage/save-storage', saveStorageConfigHandler);
  api.post('/manage/save-database', saveDatabaseConfigHandler);
  api.post('/manage/save-frontend', saveFrontendConfigHandler);
  api.get('/load-storage', loadStorageConfigHandler);
  api.get('/load-database', loadDatabaseConfigHandler);
  api.get('/load-frontend', loadFrontendConfigHandler);
  return api;
};

export { buildConfigApi };
