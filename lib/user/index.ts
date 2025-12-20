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

const updateUser = async function (userId: string, update: Record<string, DbValue>): Promise<boolean> {
  const db = await loadDb();
  return (await db.update('user_', 'userId', userId, update)) > 0;
};

const deleteUser = async function (userId: string): Promise<boolean> {
  const db = await loadDb();
  return (await db.delete('user_', 'userId', userId)) > 0;
};

const getAllUsers = async function (): Promise<User[]> {
  const db = await loadDb();
  return (await db.findAll('user_')) as unknown as User[];
};

const getUserByUserId = async function (userId: string): Promise<User | null> {
  const db = await loadDb();
  const user = await db.findOne('user_', 'userId', userId);
  return user ? (user as unknown as User) : null;
};

const getUserByUsername = async function (username: string): Promise<User | null> {
  const db = await loadDb();
  const user = await db.findOne('user_', 'username', username);
  return user ? (user as unknown as User) : null;
};

const getDisplayNames = async function (): Promise<Record<string, string>> {
  const users = await getAllUsers();
  const displayNames: Record<string, string> = {};
  users.forEach((user) => {
    displayNames[user.userId] = user.displayName;
  });
  return displayNames;
};

export { addUser, updateUser, deleteUser, getAllUsers, getUserByUserId, getUserByUsername, getDisplayNames };
