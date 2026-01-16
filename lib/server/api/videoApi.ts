import express, { Express } from 'express';
import fileUpload from 'express-fileupload';
import {
  addVideoHandler,
  deleteVideoHandler,
  downloadM3u8Handler,
  downloadThumbnailHandler,
  downloadTsHandler,
  getVideoHandler,
  getVideosHandler,
  modifyMetaHandler,
  modifyTitleHandler,
  removeTsFilesHandler,
  uploadFileHandler,
  videoManagerHandler
} from '@/server/handler/videoHandler';

const MAX_FILE_SIZE = 100 * 1_024 * 1_024; // 100 MiB

const buildVideoApi = function (): Express {
  const api = express();
  api.use('/manage/upload-file', fileUpload({ limits: { files: 1, fileSize: MAX_FILE_SIZE } }));
  api.use('/manage', videoManagerHandler);
  api.post('/manage/add', addVideoHandler);
  api.post('/manage/modify-title', modifyTitleHandler);
  api.post('/manage/modify-meta', modifyMetaHandler);
  api.delete('/manage/delete/:videoId', deleteVideoHandler);
  api.post('/manage/upload-file/:videoId', uploadFileHandler);
  api.delete('/manage/delete-ts-files/:videoId', removeTsFilesHandler);
  api.get('/single-video/:videoId', getVideoHandler);
  api.get('/videos/:since', getVideosHandler);
  api.get('/thumbnail/:prefix', downloadThumbnailHandler);
  api.get('/m3u8/:prefix', downloadM3u8Handler);
  api.get('/ts/:prefix/:name', downloadTsHandler);
  return api;
};

export { buildVideoApi };
