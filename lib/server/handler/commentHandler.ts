import express from 'express';
import { addComment, getComment, getVideoComments, markCommentAsDeleted, updateComment } from '@/comment';
import { getAllUsers, getUserByUserId } from '@/user';
import { getVideo } from '@/video';
import { User } from '@/user/types/User';
import { Comment } from '@/comment/types/Comment';

const LENGTH_THRESHOLD = 10_000;

const commentVideoManagerHandler: express.RequestHandler = async function (req, res, next) {
  const user = req.body?.authorizedUser as User | undefined;

  if (user?.videoManager) {
    return next();
  }

  res.status(403).json({ error: 'forbidden' });
};

const addCommentHandler: express.RequestHandler = async function (req, res) {
  const comment = req.body.comment as Comment;

  const givenComment = await getComment(comment.commentId ?? '-');
  if (givenComment) {
    return res.status(400).json({ error: 'comment-exists' });
  }

  const video = await getVideo(comment.videoId ?? '');
  if (!video) {
    return res.status(400).json({ error: 'no-such-video' });
  }

  const user = await getUserByUserId(comment.userId ?? '');
  if (!user) {
    return res.status(400).json({ error: 'no-such-user' });
  }

  if (comment.content.length > LENGTH_THRESHOLD) {
    return res.status(400).json({ error: 'content-too-long' });
  }

  await addComment(comment);
  res.status(201).json({ message: 'created' });
};

const editCommentHandler: express.RequestHandler = async function (req, res) {
  const { commentId, content } = req.body ?? {};

  const comment = await getComment(commentId ?? '');
  if (!comment) {
    return res.status(400).json({ error: 'no-such-comment' });
  }

  if (content.length > LENGTH_THRESHOLD) {
    return res.status(400).json({ error: 'content-too-long' });
  }

  const updated = await updateComment(commentId ?? '', content ?? comment.content ?? '');

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }

  res.status(200).json({ message: 'updated' });
};

const editOwnCommentHandler: express.RequestHandler = async function (req, res) {
  const { commentId, content, authorizedUser } = req.body ?? {};
  const comment = await getComment(commentId ?? '');

  if (!comment) {
    return res.status(400).json({ error: 'no-such-comment' });
  }

  if ((authorizedUser?.userId ?? '_') !== comment?.userId) {
    return res.status(403).json({ error: 'not-your-comment' });
  }

  if (content.length > LENGTH_THRESHOLD) {
    return res.status(400).json({ error: 'content-too-long' });
  }

  const updated = await updateComment(commentId ?? '_', content ?? comment?.content ?? '');

  if (!updated) {
    return res.status(400).json({ error: 'not-updated' });
  }

  res.status(200).json({ message: 'updated' });
};

const removeCommentHandler: express.RequestHandler = async function (req, res) {
  const { commentId } = req.params ?? {};

  const comment = await getComment(commentId ?? '');

  if (!comment) {
    return res.status(400).json({ error: 'no-such-comment' });
  }

  const marked = await markCommentAsDeleted(commentId ?? '');

  if (!marked) {
    return res.status(400).json({ error: 'not-removed' });
  }

  res.status(200).json({ message: 'removed' });
};

const removeOwnCommentHandler: express.RequestHandler = async function (req, res) {
  const { authorizedUser } = req.body ?? {};
  const { commentId } = req.params ?? {};
  const comment = await getComment(commentId ?? '');

  if (!comment) {
    return res.status(400).json({ error: 'no-such-comment' });
  }

  if ((authorizedUser?.userId ?? '_') !== comment?.userId) {
    return res.status(403).json({ error: 'not-your-comment' });
  }

  const marked = await markCommentAsDeleted(commentId ?? '_');

  if (!marked) {
    return res.status(400).json({ error: 'not-removed' });
  }

  res.status(200).json({ message: 'removed' });
};

const getVideoCommentsHandler: express.RequestHandler = async function (req, res) {
  const { videoId, page } = req.params;
  const comments = await getVideoComments(videoId ?? '', parseInt(page ?? '0'));

  res.status(200).json({ comments });
};

const getNameMappingHandler: express.RequestHandler = async function (req, res) {
  const users = await getAllUsers();
  const mapping: Record<string, string> = {};
  users.forEach((user) => {
    mapping[user.userId] = user.displayName;
  });
  res.status(200).json({ mapping });
};

export {
  commentVideoManagerHandler,
  addCommentHandler,
  editCommentHandler,
  editOwnCommentHandler,
  removeCommentHandler,
  removeOwnCommentHandler,
  getVideoCommentsHandler,
  getNameMappingHandler
};
