import { loadDb } from '@/db';
import { User } from '@/user/types/User';
import { DbValue } from '@/db/types/DbValue';

const addUser = async function ({ userId, username, ...rest }: User): Promise<void> {
  const db = await loadDb();

  const existsById = await db.exists('user_', 'userId', userId);
  if (existsById) {
    throw new Error(`User already exists with id ${userId}`);
  }

  const existsByUsername = await db.exists('user_', 'username', username);
  if (existsByUsername) {
    throw new Error(`User already exists with username ${username}`);
  }

  await db.add('user_', { ...rest, userId, username });
};

const updateUser = async function (userId: string, update: Record<string, DbValue>): Promise<void> {
  const db = await loadDb();
  await db.update('user_', 'userId', userId, update);
};

const deleteUser = async function (userId: string): Promise<void> {
  const db = await loadDb();
  await db.delete('user_', 'userId', userId);
};

const getAllUsers = async function (): Promise<User[]> {
  const db = await loadDb();
  return (await db.findAll('user_')) as unknown as User[];
};

const getUserByUserId = async function (userId: string): Promise<User> {
  const db = await loadDb();
  return (await db.findOne('user_', 'userId', userId)) as unknown as User;
};

const getUserByUsername = async function (username: string): Promise<User> {
  const db = await loadDb();
  return (await db.findOne('user_', 'username', username)) as unknown as User;
};

export { addUser, updateUser, deleteUser, getAllUsers, getUserByUserId, getUserByUsername };
