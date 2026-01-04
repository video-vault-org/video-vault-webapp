import express from 'express';
import { authorizeHandler, loginHandler } from '@/server/handler/userHandler';
import { buildUserApi } from '@/server/api/userApi';
import { buildCommentApi } from '@/server/api/commentApi';
import { buildVideoApi } from '@/server/api/videoApi';
import { buildConfigApi } from '@/server/api/configApi';
import { Request } from '@/server/types/Request';
import { isInit } from '@/init';

const buildApi = function (fallbacks: boolean) {
  const api = express();
  api.use(express.static('./web'));
  api.use(express.json());
  api.get('/init', async (_, res) => {
    const init = await isInit();
    res.status(200).json({ init });
  });
  api.post('/login', loginHandler);
  api.use('/api', authorizeHandler);
  api.use('/api/user', buildUserApi());
  api.use('/api/comment', buildCommentApi());
  api.use('/api/video', buildVideoApi());
  api.use('/api/config', buildConfigApi());

  if (fallbacks) {
    api.use((req, res) => {
      res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    api.use((error: Error, _: Request, res: express.Response, __: express.NextFunction) => {
      res.status(500).json({ error: error?.message ?? 'unknown error' });
    });
  }

  return api;
};

export { buildApi };
