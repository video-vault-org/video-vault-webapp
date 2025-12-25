import { loadDb } from '@/db';
import { Lock } from '@/auth/types/Lock';
import { DbItem } from '@/db/types/DbItem';

const THRESHOLD = 5;
const TTL_MIN = 15 * 1000; // 15 seconds
const TTL_MAX = 30 * 60 * 1000; // 30 Minutes

const countAttempt = async function (username: string): Promise<void> {
  const db = await loadDb();
  let lock = (await db.findOne('lock', 'username', username)) as Lock | null;

  if (!lock) {
    lock = { username, attempts: 0, lastAttempt: new Date() } as Lock;
    await db.add('lock', lock as unknown as DbItem);
  }

  await db.update('lock', 'username', username, { attempts: lock.attempts + 1, lastAttempt: new Date() });
};

const resetAttempts = async function (username: string): Promise<void> {
  const db = await loadDb();
  await db.delete('lock', 'username', username);
};

const handleLocking = async function (username: string): Promise<boolean> {
  const db = await loadDb();
  const lock = (await db.findOne('lock', 'username', username)) as Lock | null;
  const attempts = lock?.attempts ?? 0;

  if (!lock || attempts < THRESHOLD) {
    return false;
  }

  const factor = 2 ** (attempts - THRESHOLD);
  const ttl = Math.min(TTL_MIN * factor, TTL_MAX);
  if (lock.lastAttempt.getTime() + ttl > Date.now()) {
    await db.update('lock', 'username', username, { lastAttempt: new Date() });
    return true;
  }

  return false;
};

export { countAttempt, resetAttempts, handleLocking, THRESHOLD, TTL_MIN, TTL_MAX };
