import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 } from 'uuid';
import { loadDb } from '@/db';
import { JwtKey } from '@/auth/types/JwtKey';

const KEY_COUNT = 25;
const KEY_LENGTH = 32;
const ALGORITHM = 'HS256';
const TOKEN_EXPIRES_IN_SECONDS = 30 * 60;

const keys: JwtKey[] = [];
let index = 0;

const getRandomKey = function (): JwtKey {
  index = Math.round(Math.random() * (keys.length - 1));
  return keys[index];
};

const initJwt = async function (): Promise<number> {
  const db = await loadDb();
  const loadedKeys = (await db.findAll('jwtkey')) as unknown as JwtKey[];
  const count = loadedKeys.length;
  if (count < KEY_COUNT) {
    const remaining = KEY_COUNT - count;
    for (let i = 1; i <= remaining; i++) {
      const key = { keyId: v4(), key: crypto.randomBytes(KEY_LENGTH).toString('base64') };
      await db.add('jwtkey', key);
      keys.push(key);
    }
    return remaining;
  }
  keys.push(...loadedKeys);
  return 0;
};

const issueToken = function (id: string): string {
  const { keyId, key } = getRandomKey();
  const iat = Math.round(Date.now() / 1000);
  const exp = iat + TOKEN_EXPIRES_IN_SECONDS;
  const sub = id;
  const payload = { sub, iat, exp } as Record<string, unknown>;
  const header = { algorithm: ALGORITHM, keyid: keyId } as SignOptions;
  return jwt.sign(payload, key, header);
};

const verifyToken = function (token: string | null): boolean {
  if (!token) {
    return false;
  }
  const decoded = jwt.decode(token, { complete: true }) as jwt.JwtPayload;
  if (decoded?.header.alg !== ALGORITHM) {
    return false;
  }
  const key = keys.find((key) => key.keyId === decoded.header.kid);
  if (!key) {
    return false;
  }
  try {
    jwt.verify(token, key.key, { complete: true });
  } catch {
    return false;
  }
  return true;
};

const extractSub = function (token: string): string {
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  return decoded.sub ?? '';
};

const getExpiresAt = function (token: string): number {
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  const exp = decoded.exp ?? 0;
  return exp * 1000;
};

const getIndex = function (): number {
  return index;
};

const getKeys = function (): JwtKey[] {
  return keys;
};

const resetKeys = function () {
  keys.splice(0, KEY_COUNT);
};

export { initJwt, issueToken, verifyToken, extractSub, getExpiresAt, getIndex, getKeys, resetKeys, KEY_COUNT, ALGORITHM, TOKEN_EXPIRES_IN_SECONDS };
