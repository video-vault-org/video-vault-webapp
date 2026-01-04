import express from 'express';
import { saveConfig as saveStorageConfig, loadConfig as loadStorageConfig } from '@/storage';
import { saveConfig as saveDatabaseConfig, loadConfig as loadDatabaseConfig } from '@/db';
import { saveConfig as saveFrontendConfig, loadConfig as loadFrontendConfig } from '@/frontend';
import { AuthorizedInitRequest } from '@/server/types/AuthorizedInitRequest';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { User } from '@/user/types/User';
import { StorageConfig } from '@/storage/types/StorageConfig';
import { DatabaseConfig } from '@/db/types/DatabaseConfig';
import { FrontendConfig } from '@/frontend/types/FrontendConfig';

const adminHandler: express.RequestHandler = async function (req, res, next) {
  if ((req as AuthorizedInitRequest).authorizedInit) {
    return next();
  }

  const user = (req as AuthorizedUserRequest).authorizedUser as User | undefined;

  if (user?.admin) {
    return next();
  }

  res.status(403).json({ error: 'forbidden' });
};

const saveStorageConfigHandler: express.RequestHandler = async function (req, res) {
  const config = req.body.config as StorageConfig;
  await saveStorageConfig(config);
  res.status(200).json({ message: 'saved' });
};

const saveDatabaseConfigHandler: express.RequestHandler = async function (req, res) {
  const config = req.body.config as DatabaseConfig;
  await saveDatabaseConfig(config);
  res.status(200).json({ message: 'saved' });
};

const saveFrontendConfigHandler: express.RequestHandler = async function (req, res) {
  const config = req.body.config as FrontendConfig;
  await saveFrontendConfig(config);
  res.status(200).json({ message: 'saved' });
};

const loadStorageConfigHandler: express.RequestHandler = async function (_, res) {
  const config = (await loadStorageConfig()) as StorageConfig;
  res.status(200).json({ config });
};

const loadDatabaseConfigHandler: express.RequestHandler = async function (_, res) {
  const config = (await loadDatabaseConfig()) as DatabaseConfig;
  res.status(200).json({ config });
};

const loadFrontendConfigHandler: express.RequestHandler = async function (_, res) {
  const config = (await loadFrontendConfig()) as FrontendConfig;
  res.status(200).json({ config });
};

export {
  adminHandler,
  saveStorageConfigHandler,
  saveDatabaseConfigHandler,
  saveFrontendConfigHandler,
  loadStorageConfigHandler,
  loadDatabaseConfigHandler,
  loadFrontendConfigHandler
};
