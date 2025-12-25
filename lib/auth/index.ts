import { getUserByUserId, getUserByUsername } from '@/user';
import { scryptHashing } from '@/auth/hashing/scryptHashing';
import { extractSub, issueToken, verifyToken } from '@/auth/jwt';
import { User } from '@/user/types/User';
import { countAttempt, handleLocking, resetAttempts } from '@/auth/locking';

const authenticate = async function (username: string, password: string): Promise<string | null> {
  const locked = await handleLocking(username);
  if (locked) {
    return null;
  }

  const user = await getUserByUsername(username);
  if (!user) {
    await countAttempt(username);
    return null;
  }

  const authenticated = await scryptHashing.checkPassword(password, user.hashSalt, user.hash);
  if (!authenticated) {
    await countAttempt(username);
    return null;
  }

  await resetAttempts(username);
  return issueToken(user.userId);
};

const authorize = async function (token: string | null): Promise<User | null> {
  const authorized = verifyToken(token);
  if (!authorized) {
    return null;
  }

  const userId = extractSub(token ?? '');
  return await getUserByUserId(userId);
};

const hashPassword = async function (password: string) {
  const [salt, hash] = await scryptHashing.hashPassword(password);
  const algorithm = scryptHashing.algorithm;
  return [salt, hash, algorithm];
};

export { authenticate, authorize, hashPassword };
