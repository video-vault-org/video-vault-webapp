import { loadDb } from '@/db';
import { Video } from '@/video/types/Video';

const getVideo = async function (videoId: string): Promise<Video | null> {
  const db = await loadDb();
  const video = await db.findOne('video', 'videoId', videoId);
  return video ? (video as unknown as Video) : null;
};

export { getVideo };
