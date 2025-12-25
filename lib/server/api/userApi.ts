import express, { Express } from 'express';
import {
  addUserHandler,
  deleteUserHandler,
  getUsersHandler,
  loginHandler,
  modifyCredentialsHandler,
  modifyDisplayNameHandler,
  modifyOwnCredentialsHandler,
  modifyOwnUsernameHandler,
  modifyPermissionsHandler,
  modifyUsernameHandler,
  userManagerHandler
} from '@/server/handler/userHandler';

const buildUserApi = function (): Express {
  const api = express();
  api.use('/manage', userManagerHandler);
  api.post('/manage/add', addUserHandler);
  api.post('/manage/modify-username', modifyUsernameHandler);
  api.post('/modify-username', modifyOwnUsernameHandler);
  api.post('/manage/modify-credentials', modifyCredentialsHandler);
  api.post('/modify-credentials', modifyOwnCredentialsHandler);
  api.post('/manage/modify-permissions', modifyPermissionsHandler);
  api.post('/manage/modify-displayname', modifyDisplayNameHandler);
  api.delete('/manage/delete/:userId', deleteUserHandler);
  api.get('/manage/get-users', getUsersHandler);
  api.post('/login', loginHandler);
  return api;
};

export { buildUserApi };
