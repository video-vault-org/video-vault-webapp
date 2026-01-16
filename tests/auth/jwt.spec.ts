import jwt from 'jsonwebtoken';
import {
  initJwt,
  issueToken,
  verifyToken,
  getIndex,
  getKeys,
  extractSub,
  getExpiresAt,
  resetKeys,
  KEY_COUNT,
  ALGORITHM,
  TOKEN_EXPIRES_IN_SECONDS
} from '@/auth/jwt';
import { resetDb } from '@/db';

describe('jwt', (): void => {
  const sub = 'testUserId';
  const iat = 120;
  const fakeTime = iat * 1000;
  const exp = iat + TOKEN_EXPIRES_IN_SECONDS;
  const fakeTimeExpired = exp * 1000;

  beforeEach(async (): Promise<void> => {
    await initJwt();
    jest.useFakeTimers();
    jest.setSystemTime(fakeTime);
  });

  afterEach(async (): Promise<void> => {
    jest.useRealTimers();
    await resetDb();
    resetKeys();
  });

  test('initializes correctly.', async (): Promise<void> => {
    await resetDb();
    resetKeys();

    await initJwt();

    expect(getKeys().length).toBe(KEY_COUNT);
  });

  test('issueToken issues token correctly.', async (): Promise<void> => {
    const token = issueToken(sub);

    const decoded = jwt.decode(token, { complete: true }) as jwt.JwtPayload;
    const index = getIndex();
    const key = getKeys()[index];
    const checkToken = jwt.sign({ sub, iat, exp } as Record<string, unknown>, key.key, {
      algorithm: ALGORITHM,
      keyid: key.keyId
    });
    const checkDecoded = jwt.decode(checkToken, { complete: true }) as jwt.JwtPayload;
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.header.typ).toBe('JWT');
    expect(decoded.header.kid).toBe(getKeys()[index].keyId);
    expect(decoded.payload.sub).toBe(sub);
    expect(decoded.payload.iat).toBe(iat);
    expect(decoded.payload.exp).toBe(exp);
    expect(decoded.signature).toBe(checkDecoded.signature);
  });

  test('verifyToken returns sub of valid token.', async (): Promise<void> => {
    const token = issueToken(sub);

    const valid = verifyToken(token);

    expect(valid).toBe(true);
  });

  test('verifyToken returns empty string on expired token.', async (): Promise<void> => {
    const token = issueToken(sub);
    jest.setSystemTime(fakeTimeExpired);

    const valid = verifyToken(token);

    expect(valid).toBe(false);
  });

  test('verifyToken returns empty string on invalid token.', async (): Promise<void> => {
    const token = issueToken(sub);

    const valid = verifyToken(token.substring(0, token.length - 2));

    expect(valid).toBe(false);
  });

  test('verifyToken returns empty string on token with invalid algo.', async (): Promise<void> => {
    const token = issueToken(sub);
    const [header, payload, signature] = token.split('.');
    const changedHeaderObject = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>;
    changedHeaderObject.alg = 'other';
    const changedHeader = Buffer.from(JSON.stringify(changedHeaderObject), 'utf8').toString('base64url');
    const changedToken = [changedHeader, payload, signature].join('.');

    const valid = verifyToken(changedToken);

    expect(valid).toBe(false);
  });

  test('verifyToken returns empty string on empty token.', async (): Promise<void> => {
    const valid = verifyToken('');

    expect(valid).toBe(false);
  });

  test('verifyToken returns empty string on nullish token.', async (): Promise<void> => {
    const valid = verifyToken(null);

    expect(valid).toBe(false);
  });

  test('extractSub returns id.', async (): Promise<void> => {
    const token = issueToken(sub);

    const id = extractSub(token);

    expect(id).toBe(sub);
  });

  test('getExpiresAt returns expiration time in millis.', async (): Promise<void> => {
    const token = issueToken(sub);

    const expiresAt = getExpiresAt(token);

    expect(expiresAt).toBe(exp * 1000);
  });
});
