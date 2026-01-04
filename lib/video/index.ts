import { loadDb } from '@/db';
import { Video } from '@/video/types/Video';
import { DbItem } from '@/db/types/DbItem';
import { loadStorage } from '@/storage';
import * as path from 'node:path';

const addVideo = async function (video: Video): Promise<void> {
  const db = await loadDb();

  const exists = await db.exists('video', 'videoId', video.videoId);
  if (exists) {
    throw new Error(`Video already exists with id ${video.videoId}`);
  }

  await db.add('video', { ...video, lastModified: new Date() } as DbItem);
};

const modifyTitle = async function (videoId: string, title: string): Promise<boolean> {
  const db = await loadDb();

  return (await db.update('video', 'videoId', videoId, { title, lastModified: new Date() })) > 0;
};

const modifyMeta = async function (videoId: string, meta: Record<string, unknown>): Promise<boolean> {
  const db = await loadDb();

  return (await db.update('video', 'videoId', videoId, { meta, lastModified: new Date() })) > 0;
};

const deleteVideo = async function (videoId: string): Promise<boolean> {
  const db = await loadDb();

  return (await db.delete('video', 'videoId', videoId)) > 0;
};

const addFile = async function (videoId: string, name: string, data: Buffer): Promise<Error | null> {
  const db = await loadDb();
  const video = (await db.findOne('video', 'videoId', videoId)) as unknown as Video;
  if (!video) {
    return new Error('no-such-video');
  }
  await db.update('video', 'videoId', videoId, { lastModified: new Date() });

  const descriptor = `${path.basename(video.filesPrefix)}/${path.basename(name)}`;
  const storage = await loadStorage();
  await storage.save(descriptor, data);
  return null;
};

const deleteFile = async function (videoId: string, name: string): Promise<[Error] | [null, boolean]> {
  const db = await loadDb();
  const video = (await db.findOne('video', 'videoId', videoId)) as unknown as Video;
  if (!video) {
    return [new Error('no-such-video')];
  }
  await db.update('video', 'videoId', videoId, { lastModified: new Date() });

  const descriptor = `${path.basename(video.filesPrefix)}/${path.basename(name)}`;
  const storage = await loadStorage();
  return [null, await storage.delete(descriptor)];
};

const deleteAllFiles = async function (videoId: string): Promise<[Error] | [null, boolean]> {
  const video = await getVideo(videoId);
  if (!video) {
    return [new Error('no-such-video')];
  }

  const descriptor = path.basename(video.filesPrefix);
  const storage = await loadStorage();
  return [null, (await storage.deleteDir(descriptor)) > 0];
};

const readFile = async function (prefix: string, name: string): Promise<Buffer | null> {
  const descriptor = `${path.basename(prefix)}/${path.basename(name)}`;
  const storage = await loadStorage();
  return await storage.read(descriptor);
};

const getVideo = async function (videoId: string): Promise<Video | null> {
  const db = await loadDb();
  const video = await db.findOne('video', 'videoId', videoId);
  return video ? (video as unknown as Video) : null;
};

const getVideos = async function (since: Date): Promise<Video[]> {
  const db = await loadDb();
  return (await db.findAllSince('video', since)) as unknown as Video[];
};

export { addVideo, modifyTitle, modifyMeta, deleteVideo, addFile, deleteFile, deleteAllFiles, readFile, getVideo, getVideos };
