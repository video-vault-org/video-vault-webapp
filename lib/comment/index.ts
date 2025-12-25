import { loadDb } from '@/db';
import { Comment } from '@/comment/types/Comment';

const PAGE_SIZE = 100;

const addComment = async function ({ commentId, ...rest }: Comment) {
  const db = await loadDb();
  const exists = await db.exists('comment', 'commentId', commentId);

  if (exists) {
    throw new Error(`Comment already exists with id ${commentId}`);
  }

  const now = new Date();
  await db.add('comment', { commentId, ...rest, edited: false, deleted: false, created: now, lastModified: now });
};

const updateComment = async function (commentId: string, content: string): Promise<boolean> {
  const db = await loadDb();
  return (await db.update('comment', 'commentId', commentId, { content, edited: true, lastModified: new Date() })) > 0;
};

const markCommentAsDeleted = async function (commentId: string): Promise<boolean> {
  const db = await loadDb();
  return (await db.update('comment', 'commentId', commentId, { content: '', deleted: true, lastModified: new Date() })) > 0;
};

const markUserCommentsAsDeleted = async function (userId: string): Promise<boolean> {
  const db = await loadDb();
  return (await db.update('comment', 'userId', userId, { content: '', deleted: true, lastModified: new Date() })) > 0;
};

const deleteVideoComments = async function (videoId: string): Promise<boolean> {
  const db = await loadDb();
  return (await db.delete('comment', 'videoId', videoId)) > 0;
};

const getComment = async function (commentId: string): Promise<Comment | null> {
  const db = await loadDb();
  const comment = await db.findOne('comment', 'commentId', commentId);
  return comment ? (comment as unknown as Comment) : null;
};

const getVideoComments = async function (videoId: string, page: number): Promise<Comment[]> {
  const db = await loadDb();
  const comments = await db.findMany('comment', 'videoId', videoId, { skip: (page - 1) * PAGE_SIZE, get: PAGE_SIZE });
  return comments as unknown as Comment[];
};

export { addComment, updateComment, markCommentAsDeleted, markUserCommentsAsDeleted, deleteVideoComments, getComment, getVideoComments };
