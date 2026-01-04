import request from 'supertest';
import express from 'express';
import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { buildCommentApi } from '@/server/api/commentApi';
import { PAGE_SIZE } from '@/comment';
import { AuthorizedUserRequest } from '@/server/types/AuthorizedUserRequest';
import { User } from '@/user/types/User';
import { Comment } from '@/comment/types/Comment';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

describe('api - comment', () => {
  const testComment: Comment = {
    commentId: 'testCommentId',
    videoId: 'testVideoId',
    userId: 'testUserId',
    content: 'testContent',
    created: new Date(5),
    edited: false,
    deleted: false,
    lastModified: new Date(5)
  };

  const testUser: User = {
    userId: 'testUserId',
    username: 'testName',
    displayName: 'testDisplayName',
    passwordKeySalt: 'testSalt',
    userKey: 'testKey',
    hash: 'testHash',
    hashSalt: 'testSalt',
    hashAlgorithm: 'testAlgo',
    userManager: true,
    videoManager: false,
    admin: true
  };

  const buildApi = function (videoManager: boolean) {
    const commentApi = buildCommentApi();
    const api = express();
    api.use(async (req, _, next) => {
      (req as AuthorizedUserRequest).authorizedUser = { ...testUser, videoManager };
      next();
    });
    api.use(express.json());
    api.use('/comment', commentApi);
    return api;
  };

  beforeEach(async () => {
    mocked_db.getMemory().comment = { name: 'comment', key: '', fields: {}, items: [] };
    mocked_db.getMemory().video = { name: 'video', key: '', fields: {}, items: [] };
    mocked_db.getMemory().user_ = { name: 'user_', key: '', fields: {}, items: [] };
  });

  afterEach(() => {
    delete mocked_db.getMemory().comment;
    delete mocked_db.getMemory().video;
    delete mocked_db.getMemory().user;
  });

  describe('commentVideoManagerHandler', () => {
    test('calls next if user is video manager.', async () => {
      const api = buildApi(true);
      api.post('/comment/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/comment/manage/test');

      expect(response.status).toBe(200);
      expect(response.body?.message).toEqual('ok');
    });

    test('responses error if user is not video manager.', async () => {
      const api = buildApi(false);
      api.post('/comment/manage/test', (_, res) => {
        res.status(200).json({ message: 'ok' });
      });

      const response = await request(api).post('/comment/manage/test');

      expect(response.status).toBe(403);
      expect(response.body?.error).toEqual('forbidden');
    });
  });

  describe('addCommentHandler', () => {
    test('adds comment.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ videoId: testComment.videoId });
      mocked_db.getMemory().user_.items.push({ userId: testComment.userId });

      const response = await request(api).post('/comment/add').send({ comment: testComment });

      expect(response.status).toBe(201);
      expect(response.body.message).toEqual('created');
      expect(mocked_db.getMemory().comment.items.at(0)?.commentId).toEqual(testComment.commentId);
    });

    test('responses error if comment already exists.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ videoId: testComment.videoId });
      mocked_db.getMemory().comment.items.push({ ...testComment });
      mocked_db.getMemory().user_.items.push({ userId: testComment.userId });

      const response = await request(api).post('/comment/add').send({ comment: testComment });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('comment-exists');
      expect(mocked_db.getMemory().comment.items.length).toBe(1);
    });

    test('responses error if comment content is too long.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().video.items.push({ videoId: testComment.videoId });
      mocked_db.getMemory().user_.items.push({ userId: testComment.userId });

      const response = await request(api)
        .post('/comment/add')
        .send({ comment: { ...testComment, content: 'a'.repeat(10_001) } });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('content-too-long');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });

    test('responses error if video does not exist.', async () => {
      mocked_db.getMemory().user_.items.push({ userId: testComment.userId });
      const api = buildApi(false);

      const response = await request(api)
        .post('/comment/add')
        .send({ comment: { ...testComment, videoId: 'nope' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('no-such-video');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });

    test('responses error if user does not exist.', async () => {
      mocked_db.getMemory().video.items.push({ videoId: testComment.videoId });
      mocked_db.getMemory().user_.items.push({ userId: testComment.userId });
      const api = buildApi(false);

      const response = await request(api)
        .post('/comment/add')
        .send({ comment: { ...testComment, userId: 'nope' } });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-user');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });
  });

  describe('editCommentHandler', () => {
    test('edits comment.', async () => {
      mocked_db.getMemory().comment.items.push({ ...testComment });
      const api = buildApi(true);

      const response = await request(api).post('/comment/manage/edit').send({ commentId: testComment.commentId, content: 'new content' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().comment.items.at(0)?.content).toEqual('new content');
    });

    test('responses error if comment does not exist.', async () => {
      const api = buildApi(true);

      const response = await request(api).post('/comment/manage/edit').send({ commentId: testComment.commentId, content: 'new content' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-comment');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });

    test('responses error if comment content is too long.', async () => {
      const api = buildApi(true);
      mocked_db.getMemory().comment.items.push({ ...testComment });

      const response = await request(api)
        .post('/comment/manage/edit')
        .send({ commentId: testComment.commentId, content: 'a'.repeat(10_001) });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('content-too-long');
      expect(mocked_db.getMemory().comment.items.at(0)?.content).toEqual(testComment.content);
    });
  });

  describe('editOwnCommentHandler', () => {
    test('edits comment.', async () => {
      mocked_db.getMemory().comment.items.push({ ...testComment });
      const api = buildApi(false);

      const response = await request(api).post('/comment/edit').send({ commentId: testComment.commentId, content: 'new content' });

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('updated');
      expect(mocked_db.getMemory().comment.items.at(0)?.content).toEqual('new content');
    });

    test('responses error if comment does not exist.', async () => {
      const api = buildApi(false);

      const response = await request(api).post('/comment/edit').send({ commentId: testComment.commentId, content: 'new content' });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-comment');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });

    test('responses error if comment content is too long.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().comment.items.push({ ...testComment });

      const response = await request(api)
        .post('/comment/edit')
        .send({ commentId: testComment.commentId, content: 'a'.repeat(10_001) });

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('content-too-long');
      expect(mocked_db.getMemory().comment.items.at(0)?.content).toEqual(testComment.content);
    });

    test('responses error if it is not the own comment.', async () => {
      const api = buildApi(false);
      mocked_db.getMemory().comment.items.push({ ...testComment, userId: 'other' });

      const response = await request(api).post('/comment/edit').send({ commentId: testComment.commentId, content: '-' });

      expect(response.status).toBe(403);
      expect(response.body.error).toEqual('not-your-comment');
      expect(mocked_db.getMemory().comment.items.at(0)?.content).toEqual(testComment.content);
    });
  });

  describe('removeCommentHandler', () => {
    test('marks comment as deleted.', async () => {
      mocked_db.getMemory().comment.items.push({ ...testComment });
      const api = buildApi(true);

      const response = await request(api).delete('/comment/manage/remove/' + testComment.commentId);

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('removed');
      expect(mocked_db.getMemory().comment.items.at(0)?.deleted).toBe(true);
    });

    test('responses error if comment does not exist.', async () => {
      const api = buildApi(true);

      const response = await request(api).delete('/comment/manage/remove/' + testComment.commentId);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-comment');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });
  });

  describe('removeOwnCommentHandler', () => {
    test('marks comment as deleted.', async () => {
      mocked_db.getMemory().comment.items.push({ ...testComment });
      const api = buildApi(false);

      const response = await request(api).delete('/comment/remove/' + testComment.commentId);

      expect(response.status).toBe(200);
      expect(response.body.message).toEqual('removed');
      expect(mocked_db.getMemory().comment.items.at(0)?.deleted).toBe(true);
    });

    test('responses error if comment does not exist.', async () => {
      const api = buildApi(false);

      const response = await request(api).delete('/comment/remove/' + testComment.commentId);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual('no-such-comment');
      expect(mocked_db.getMemory().comment.items.length).toBe(0);
    });

    test('responses error if comment is not own comment.', async () => {
      mocked_db.getMemory().comment.items.push({ ...testComment, userId: 'other' });
      const api = buildApi(false);

      const response = await request(api).delete('/comment/remove/' + testComment.commentId);

      expect(response.status).toBe(403);
      expect(response.body.error).toEqual('not-your-comment');
      expect(mocked_db.getMemory().comment.items.at(0)?.deleted).toBe(false);
    });
  });

  describe('getVideoCommentsHandler', () => {
    const addSomeComments = async function () {
      for (let i = 0; i <= (PAGE_SIZE + 10) * 2; i++) {
        const videoId = i % 2 ? 'other' : testComment.videoId;
        const commentId = testComment.commentId + i;
        const lastModified = new Date(i);
        mocked_db.getMemory().comment.items.push({ ...testComment, commentId, videoId, lastModified });
      }
    };

    test('gets all comments of video on page 1.', async () => {
      await addSomeComments();
      const api = buildApi(false);

      const response = await request(api).get('/comment/testVideoId/1');

      expect(response.status).toBe(200);
      expect(response.body.comments.length).toBe(100);
      expect(response.body.comments.at(0)?.commentId).toEqual(testComment.commentId + 0);
      expect(response.body.comments.at(99)?.commentId).toEqual(testComment.commentId + 198);
      expect(response.body.comments.at(0)?.videoId).toEqual(testComment.videoId);
      expect(response.body.comments.at(99)?.videoId).toEqual(testComment.videoId);
      expect(response.body.comments.at(0)?.lastModified).toEqual(new Date(0).toISOString());
      expect(response.body.comments.at(99)?.lastModified).toEqual(new Date(198).toISOString());
    });

    test('gets all comments of video on page 2.', async () => {
      await addSomeComments();
      const api = buildApi(false);

      const response = await request(api).get('/comment/testVideoId/2');

      expect(response.status).toBe(200);
      expect(response.body.comments.length).toBe(11);
      expect(response.body.comments.at(0)?.commentId).toEqual(testComment.commentId + 200);
      expect(response.body.comments.at(10)?.commentId).toEqual(testComment.commentId + 220);
      expect(response.body.comments.at(0)?.videoId).toEqual(testComment.videoId);
      expect(response.body.comments.at(10)?.videoId).toEqual(testComment.videoId);
    });
  });

  describe('getNameMappingHandler', () => {
    test('gets mapping.', async () => {
      mocked_db.getMemory().user_.items.push({ userId: 'a', displayName: 'x' });
      mocked_db.getMemory().user_.items.push({ userId: 'b', displayName: 'y' });
      mocked_db.getMemory().user_.items.push({ userId: 'c', displayName: 'z' });
      const api = buildApi(false);

      const response = await request(api).get('/comment/name-mapping');

      expect(response.status).toBe(200);
      expect(response.body.mapping).toEqual({ a: 'x', b: 'y', c: 'z' });
    });
  });
});
