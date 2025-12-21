import { DbTableDefinition } from '@/db/types/DbTableDefinition';

const comment: DbTableDefinition = {
  table: 'comment',
  key: 'commentId',
  fields: {
    commentId: 'string',
    userId: 'string',
    videoId: 'string',
    content: 'string',
    created: 'Date',
    edited: 'boolean',
    lastModified: 'Date',
    deleted: 'boolean'
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

const jwtkey: DbTableDefinition = {
  table: 'jwtkey',
  key: 'keyId',
  fields: {
    keyId: 'string',
    key: 'string'
  }
};

const lock: DbTableDefinition = {
  table: 'lock',
  key: 'username',
  fields: {
    username: 'string',
    attempts: 'number',
    lastAttempt: 'Date'
  }
};

const tables = [comment, user, video, jwtkey, lock];

export { tables };
