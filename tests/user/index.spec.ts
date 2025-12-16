import { InMemoryDatabaseAdapter } from '@/db/adapters/InMemoryDatabaseAdapter';
import { addUser, updateUser, deleteUser, getAllUsers, getUserByUserId, getUserByUsername } from '@/user';

const mocked_db = new InMemoryDatabaseAdapter();

jest.mock('@/db', () => {
  // noinspection JSUnusedGlobalSymbols used as mock
  return {
    async loadDb() {
      return mocked_db;
    }
  };
});

describe('user', () => {
  const testUser = {
    userId: 'testId',
    username: 'testName',
    passwordKeySalt: 'testSalt',
    userKey: 'testKey',
    loginHash: 'testHash',
    userManager: true,
    videoManager: false,
    admin: true
  };

  beforeEach(() => {
    mocked_db.getMemory().user_ = { name: 'user_', key: '', fields: {}, items: [] };
  });

  afterEach(() => {
    delete mocked_db.getMemory().user_;
  });

  test('addUser adds user.', async () => {
    await addUser(testUser);

    const users = mocked_db.getMemory().user_.items;
    expect(users.length).toBe(1);
    expect(users.at(0)).toEqual(testUser);
  });

  test('updateUser updates user.', async () => {
    mocked_db.getMemory().user_.items.push(testUser);

    await updateUser(testUser.userId, { userKey: 'key2' });

    const users = mocked_db.getMemory().user_.items;
    expect(users.length).toBe(1);
    expect(users.at(0)).toEqual({ ...testUser, userKey: 'key2' });
  });

  test('deleteUser deletes user.', async () => {
    mocked_db.getMemory().user_.items.push(testUser);

    await deleteUser(testUser.userId);

    const users = mocked_db.getMemory().user_.items;
    expect(users.length).toBe(0);
  });

  test('getAllUsers gets all users.', async () => {
    const user1 = { ...testUser, userId: 'Id1', username: 'name1' };
    const user2 = { ...testUser, userId: 'Id2', username: 'name2' };
    const user3 = { ...testUser, userId: 'Id3', username: 'name3' };
    mocked_db.getMemory().user_.items.push(user1);
    mocked_db.getMemory().user_.items.push(user2);
    mocked_db.getMemory().user_.items.push(user3);

    const users = await getAllUsers();

    expect(users).toEqual([user1, user2, user3]);
  });

  test('getUserByUserId gets correct user.', async () => {
    const user1 = { ...testUser, userId: 'Id1', username: 'name1' };
    const user2 = { ...testUser, userId: 'Id2', username: 'name2' };
    mocked_db.getMemory().user_.items.push(user1);
    mocked_db.getMemory().user_.items.push(user2);

    const user = await getUserByUserId('Id1');

    expect(user).toEqual(user1);
  });

  test('getUserByUsername gets correct user.', async () => {
    const user1 = { ...testUser, userId: 'Id1', username: 'name1' };
    const user2 = { ...testUser, userId: 'Id2', username: 'name2' };
    mocked_db.getMemory().user_.items.push(user1);
    mocked_db.getMemory().user_.items.push(user2);

    const user = await getUserByUsername('name2');

    expect(user).toEqual(user2);
  });
});
