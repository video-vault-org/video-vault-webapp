import { DbTableDefinition } from '@/db/types/DbTableDefinition';

const comment: DbTableDefinition = {
  table: 'comment',
  key: 'commentId',
  fields: {
    commentId: 'string',
    userId: 'string',
    videoId: 'string',
    content: 'string',
    dateCreated: 'Date',
    edited: 'boolean',
    dateModified: 'Date'
  }
};

const user: DbTableDefinition = {
  table: 'user_',
  key: 'userId',
  fields: {
    userId: 'string',
    username: 'string',
    loginHash: 'string',
    passwordKeySalt: 'string',
    userKey: 'string',
    admin: 'boolean',
    userManager: 'boolean',
    videoManager: 'boolean'
  }
};

const video: DbTableDefinition = {
  table: 'video',
  key: 'videoId',
  fields: {
    videoId: 'string',
    title: 'string',
    meta: 'object',
    filesPrefix: 'string'
  }
};

const tables = [comment, user, video];

export { tables };
