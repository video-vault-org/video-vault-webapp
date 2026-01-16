import express, { Express } from 'express';
import {
  addCommentHandler,
  commentVideoManagerHandler,
  editCommentHandler,
  editOwnCommentHandler,
  getNameMappingHandler,
  getVideoCommentsHandler,
  removeCommentHandler,
  removeOwnCommentHandler
} from '@/server/handler/commentHandler';

const buildCommentApi = function (): Express {
  const api = express();
  api.use('/manage', commentVideoManagerHandler);
  api.post('/add', addCommentHandler);
  api.post('/manage/edit', editCommentHandler);
  api.post('/edit', editOwnCommentHandler);
  api.delete('/manage/remove/:commentId', removeCommentHandler);
  api.delete('/remove/:commentId', removeOwnCommentHandler);
  api.get('/:videoId/:page', getVideoCommentsHandler);
  api.get('/name-mapping', getNameMappingHandler);
  return api;
};

export { buildCommentApi };
