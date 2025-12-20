import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import {
  addComment,
  deleteVideoComments, getComment, getVideoComments,
  markCommentAsDeleted,
  markUserCommentsAsDeleted,
  updateComment
} from '@/comment';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

describe('comment', () => {
  const testComment = {
    commentId: 'testId',
    userId: 'testUserId',
    videoId: 'testVideoId',
    content: 'testContent',
    created: new Date(0),
    edited: false,
    lastModified: new Date(0),
    deleted: false
  };

  const expectedDate = new Date(42);

  beforeEach(() => {
    mocked_db.getMemory().comment = { name: 'comment', key: '', fields: {}, items: [] };
    jest.useFakeTimers();
    jest.setSystemTime(42);
  });

  afterEach(() => {
    delete mocked_db.getMemory().comment;
    jest.useRealTimers();
  });

  test('addComment adds comment correctly.', async () => {
    await addComment(testComment);

    const comments = mocked_db.getMemory().comment.items;
    expect(comments.length).toBe(1);
    expect(comments.at(0)).toEqual({ ...testComment, created: expectedDate, lastModified: expectedDate });
  });

  test('updateComment updates comment correctly.', async () => {
    mocked_db.getMemory().comment.items.push(testComment);

    const updated = await updateComment(testComment.commentId, 'newContent');

    const comments = mocked_db.getMemory().comment.items;
    expect(comments.length).toBe(1);
    expect(comments.at(0)).toEqual({ ...testComment, lastModified: expectedDate, edited: true, content: 'newContent' });
    expect(updated).toBe(true);
  });

  test('markCommentAsDeleted marks comment correctly.', async () => {
    mocked_db.getMemory().comment.items.push({ ...testComment });
    mocked_db.getMemory().comment.items.push({ ...testComment, commentId: 'other' });

    const markedAsDeleted = await markCommentAsDeleted(testComment.commentId);

    const comments = mocked_db.getMemory().comment.items;
    expect(comments.length).toBe(2);
    expect(comments.at(0)).toEqual({ ...testComment, lastModified: expectedDate, deleted: true, content: '' });
    expect(comments.at(1)).toEqual({ ...testComment, commentId: 'other' });
    expect(markedAsDeleted).toBe(true);
  });

  test('markUserCommentsAsDeleted marks comments correctly.', async () => {
    mocked_db.getMemory().comment.items.push({ ...testComment });
    mocked_db.getMemory().comment.items.push({ ...testComment, commentId: 'other' });
    mocked_db.getMemory().comment.items.push({ ...testComment, commentId: 'other2', userId: 'other' });

    const markedAsDeleted = await markUserCommentsAsDeleted(testComment.userId);

    const comments = mocked_db.getMemory().comment.items;
    expect(comments.length).toBe(3);
    expect(comments.at(0)).toEqual({ ...testComment, lastModified: expectedDate, deleted: true, content: '' });
    expect(comments.at(1)).toEqual({ ...testComment, lastModified: expectedDate, deleted: true, content: '', commentId: 'other' });
    expect(comments.at(2)).toEqual({ ...testComment, commentId: 'other2', userId: 'other' });
    expect(markedAsDeleted).toBe(true);
  });

  test('deleteVideoComments deletes comments correctly.', async () => {
    mocked_db.getMemory().comment.items.push({ ...testComment });
    mocked_db.getMemory().comment.items.push({ ...testComment, commentId: 'other' });
    mocked_db.getMemory().comment.items.push({ ...testComment, commentId: 'other2', videoId: 'other' });

    const deleted = await deleteVideoComments(testComment.videoId);

    const comments = mocked_db.getMemory().comment.items;
    expect(comments.length).toBe(1);
    expect(comments.at(0)).toEqual({ ...testComment, commentId: 'other2', videoId: 'other' });
    expect(deleted).toBe(true);
  });

  test('getComment gets comment.', async () => {
    mocked_db.getMemory().comment.items.push({ ...testComment });

    const comment = await getComment(testComment.commentId);

    expect(comment).toEqual(testComment);
  });

  test('getVideoComments gets all video comments, paged.', async () => {
    for (let i = 0; i < 130; i++) {
      const videoId = i < 5 ? 'other' : testComment.videoId;
      mocked_db.getMemory().comment.items.push({ ...testComment, commentId: testComment.commentId + i, videoId });
    }

    const comments1 = await getVideoComments(testComment.videoId, 1);
    const comments2 = await getVideoComments(testComment.videoId, 2);

    expect(comments1.length).toBe(100);
    expect(comments2.length).toBe(25);
    expect(comments1.at(12)?.commentId).toEqual('testId17');
    expect(comments2.at(5)?.commentId).toEqual('testId110');
  });
});
