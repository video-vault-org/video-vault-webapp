import stream from 'stream';
import express from 'express';
import { ParsedQs } from 'qs';
import { UploadedFile } from 'express-fileupload';
import { addFile, addVideo, deleteAllFiles, deleteVideo, getVideo, getVideos, modifyMeta, modifyTitle, readFile, deleteTsFiles } from '@/video';
import { deleteVideoComments } from '@/comment';
import { User } from '@/user/types/User';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Request = express.Request<Record<string, any>, any, Record<string, unknown> | undefined, ParsedQs>;

interface Files {
  [key: string]: UploadedFile;
}

type UploadRequest = Request & { files: Files };

const videoManagerHandler: express.RequestHandler = async function (req, res, next) {
  const authorizedUser = (req as AuthorizedUserRequest).authorizedUser as User | undefined;

  if (authorizedUser?.videoManager) {
    return next();
  }

  res.status(403).json({ error: 'forbidden' });
};

const addVideoHandler: express.RequestHandler = async function (req, res) {
  const video = req.body.video;

  const givenVideo = await getVideo(video.videoId);
  if (givenVideo) {
    return res.status(400).json({ error: 'video-exists' });
  }

  await addVideo(video);
  res.status(201).json({ message: 'created' });
};

const modifyTitleHandler: express.RequestHandler = async function (req, res) {
  const { videoId, title } = req.body;

  const video = await getVideo(videoId);
  if (!video) {
    return res.status(400).json({ error: 'no-such-video' });
  }

  const updated = await modifyTitle(videoId, title);
  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }

  res.status(200).json({ message: 'updated' });
};

const modifyMetaHandler: express.RequestHandler = async function (req, res) {
  const { videoId, meta } = req.body;

  const video = await getVideo(videoId);
  if (!video) {
    return res.status(400).json({ error: 'no-such-video' });
  }

  const updated = await modifyMeta(videoId, meta);
  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }

  res.status(200).json({ message: 'updated' });
};

const deleteVideoHandler: express.RequestHandler = async function (req, res) {
  const { videoId } = req.params;

  const video = await getVideo(videoId);
  if (!video) {
    return res.status(400).json({ error: 'no-such-video' });
  }

  const [error, deletedFiles] = await deleteAllFiles(videoId);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!deletedFiles) {
    return res.status(400).json({ error: 'not-deleted-video-files' });
  }

  const deletedComments = await deleteVideoComments(videoId);
  if (!deletedComments) {
    return res.status(400).json({ error: 'not-deleted-video-comments' });
  }

  const deletedVideo = await deleteVideo(videoId);
  if (!deletedVideo) {
    return res.status(400).json({ error: 'not-deleted-video' });
  }

  res.status(200).json({ message: 'removed' });
};

const getVideoHandler: express.RequestHandler = async function (req, res) {
  const { videoId } = req.params;

  const video = await getVideo(videoId);
  if (!video) {
    return res.status(400).json({ error: 'no-such-video' });
  }

  res.status(200).json({ video });
};

const getVideosHandler: express.RequestHandler = async function (req, res) {
  const sinceStr = req.params.since as string;

  let since = new Date(0);
  const sinceDate = new Date(sinceStr);
  if (sinceDate.toString() !== 'Invalid Date') {
    since = sinceDate;
  }
  const videos = await getVideos(since);
  res.status(200).json({ videos });
};

const uploadFileHandler: express.RequestHandler = async function (req, res) {
  const videoId = req.params.videoId as string;

  const files = (req as UploadRequest).files;
  const key = Object.keys(files).at(0) ?? 'file';
  const { data, name } = files[key];

  const error = await addFile(videoId, name, data);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ message: 'uploaded' });
};

const removeTsFilesHandler: express.RequestHandler = async function (req, res) {
  const videoId = req.params.videoId as string;

  const [error, deleted] = await deleteTsFiles(videoId);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!deleted) {
    return res.status(400).json({ error: 'not-removed' });
  }

  res.status(200).json({ message: 'removed' });
};

const downloadHandler = async function (req: Request, res: express.Response, name: string, mimetype: string) {
  const prefix = req.params.prefix as string;

  const data = await readFile(prefix ?? '-', name);
  if (!data) {
    return res.status(404).json({ error: 'no-such-file' });
  }

  const readStream = new stream.PassThrough();
  readStream.end(data);

  res.set('Content-Disposition', 'attachment; filename=' + name);
  res.set('Content-Type', mimetype);
  res.set('Content-Length', data.length + '');

  readStream.pipe(res);
};

const downloadThumbnailHandler: express.RequestHandler = async function (req, res) {
  const name = 'thumbnail.jpg.enc';
  await downloadHandler(req, res, name, 'image/jpg');
};

const downloadM3u8Handler: express.RequestHandler = async function (req, res) {
  const name = 'index.m3u8.enc';
  await downloadHandler(req, res, name, 'application/x-mpegURL');
};

const downloadTsHandler: express.RequestHandler = async function (req, res) {
  const name = req.params.name as string;
  await downloadHandler(req, res, name ?? '0.ts.enc', 'video/mp2t');
};

export {
  videoManagerHandler,
  addVideoHandler,
  modifyTitleHandler,
  modifyMetaHandler,
  deleteVideoHandler,
  getVideoHandler,
  getVideosHandler,
  uploadFileHandler,
  removeTsFilesHandler,
  downloadThumbnailHandler,
  downloadM3u8Handler,
  downloadTsHandler
};
