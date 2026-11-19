import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { User } from '@/domain/User';
import { hashPassword, verifyPassword } from '@/util/password';

/**
 * Authenticates users with HS256 JWTs and throttles logins using persistent failed-attempt counters.
 * Login attempts for the same username are serialized within this instance.
 * Use one AuthService instance per Node process; separate instances or processes are not coordinated.
 */
class AuthService {
  private readonly pendingLogins = new Map<string, Promise<string | null>>();
  private readonly db: DatabaseAdapter;
  private readonly keyDirectory: string;
  private readonly tokenLifetimeSeconds: number;
  private keys = new Map<string, Buffer>();
  private initialization: Promise<void> | null = null;
  private dummyPasswordHash = '';

  /**
   * @param db The database adapter used for users and failed login attempts.
   * @param options JWT key directory and token lifetime; defaults to ./jwtkeys and one hour.
   * @throws If the token lifetime is not a positive safe integer in seconds.
   */
  public constructor(db: DatabaseAdapter, { keyDirectory = './jwtkeys', tokenLifetimeSeconds = 3600 }: { keyDirectory?: string; tokenLifetimeSeconds?: number } = {}) {
    if (!Number.isSafeInteger(tokenLifetimeSeconds) || tokenLifetimeSeconds <= 0) {
      throw new RangeError('tokenLifetimeSeconds must be a positive safe integer');
    }
    this.db = db;
    this.keyDirectory = resolve(keyDirectory);
    this.tokenLifetimeSeconds = tokenLifetimeSeconds;
  }

  /**
   * Loads ten 256-bit HMAC keys, creating missing key-0.key through key-9.key files without overwriting existing keys.
   * New directories use mode 0700 and new key files use mode 0600.
   * Call before login or authenticate. Repeated and concurrent calls reuse the initialization.
   * @throws If key files cannot be loaded or created, or a key is not exactly 32 bytes long.
   */
  public async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.loadKeys().catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  /**
   * Verifies the client's Base64 loginHash as a password and signs a JWT using a randomly selected key.
   * Failures are counted per username, including unknown usernames. Failure 5 starts a 15-second lock;
   * subsequent failures after expiry double the duration, capped at 15 minutes.
   * Attempts during a lock restart its duration without checking the password or incrementing the counter.
   * A successful login removes the failed-attempt counter.
   * @param username The username to authenticate.
   * @param loginHash The Base64 loginHash produced by the client, not the stored scrypt string.
   * @returns A signed JWT on success, or null for invalid credentials or an active lock.
   * @throws If initialization has not completed or a database or cryptographic operation fails.
   */
  public async login({ username, loginHash }: { username: string; loginHash: string }): Promise<string | null> {
    this.requireInitialized();
    // noinspection ES6MissingAwait (we need promise here)
    const previous = this.pendingLogins.get(username) ?? Promise.resolve(null);
    const current = previous.catch(() => null).then(() => this.performLogin(username, loginHash));
    this.pendingLogins.set(username, current);
    try {
      return await current;
    } finally {
      if (this.pendingLogins.get(username) === current) {
        this.pendingLogins.delete(username);
      }
    }
  }

  /**
   * Verifies a JWT's HS256 signature, key ID, issuer, audience and expiration, then loads its current user.
   * User data and roles are read from the database rather than trusted from token claims.
   * @param token The raw JWT, without a Bearer prefix.
   * @returns The current user, or null for an invalid or expired token or a deleted user.
   * @throws If initialization has not completed or the database query fails.
   */
  public async authenticate({ token }: { token: string }): Promise<User | null> {
    this.requireInitialized();
    let userId: string;
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || decoded.header.alg !== 'HS256' || typeof decoded.header.kid !== 'string') {
        return null;
      }
      const key = this.keys.get(decoded.header.kid);
      if (!key) {
        return null;
      }
      const verified = jwt.verify(token, key, { algorithms: ['HS256'], issuer: 'video-vault', audience: 'video-vault' });
      if (typeof verified === 'string' || typeof verified.sub !== 'string' || !verified.sub || !Number.isSafeInteger(verified.exp)) {
        return null;
      }
      userId = verified.sub;
    } catch (error: unknown) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
    return await this.db.findOneUserByUserId({ userId });
  }

  /**
   * Returns the roles enabled on an authenticated user, in admin, editor, moderator order.
   * @param user The authenticated user whose current role flags should be evaluated.
   * @returns Enabled roles, or an empty array if no role is enabled.
   */
  public authorize(user: User): ('admin' | 'editor' | 'moderator')[] {
    const roles: ('admin' | 'editor' | 'moderator')[] = [];
    if (user.admin) roles.push('admin');
    if (user.editor) roles.push('editor');
    if (user.moderator) roles.push('moderator');
    return roles;
  }

  private requireInitialized(): void {
    if (this.keys.size !== 10) {
      throw new Error('AuthService is not initialized');
    }
  }

  private async loadKeys(): Promise<void> {
    await mkdir(this.keyDirectory, { recursive: true, mode: 0o700 });
    const keys = new Map<string, Buffer>();
    for (let index = 0; index < 10; index++) {
      const id = `key-${index}`;
      const path = join(this.keyDirectory, `${id}.key`);
      let key: Buffer;
      try {
        key = await readFile(path);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          throw error;
        }
        key = randomBytes(32);
        await writeFile(path, key, { flag: 'wx', mode: 0o600 });
      }
      if (key.length !== 32) {
        throw new Error(`Invalid JWT key: ${id}; expected 32 bytes`);
      }
      keys.set(id, key);
    }
    this.dummyPasswordHash = await hashPassword(randomBytes(32).toString('base64'));
    this.keys = keys;
  }

  private async performLogin(username: string, loginHash: string): Promise<string | null> {
    const attempts = await this.db.findOneAttemptsCountByUsername({ username });
    const now = new Date();
    const duration = attempts && attempts.attempts >= 5 ? Math.min(15_000 * 2 ** Math.min(attempts.attempts - 5, 6), 900_000) : 0;
    if (attempts && duration > 0 && now.getTime() < attempts.lastAttempt.getTime() + duration) {
      await this.db.changeAttemptsLastAttemptByUsername({ username, lastAttempt: now });
      return null;
    }
    const user = await this.db.findOneUserByUsername({ username });
    const matches = await verifyPassword(loginHash, user?.loginHash ?? this.dummyPasswordHash);
    if (!user || !matches) {
      await this.db.increaseAttemptsCountByUsername({ username, lastAttempt: new Date() });
      return null;
    }
    const [kid, key] = Array.from(this.keys.entries())[randomInt(this.keys.size)];
    const token = jwt.sign({}, key, { algorithm: 'HS256', keyid: kid, subject: user.userId, expiresIn: this.tokenLifetimeSeconds, issuer: 'video-vault', audience: 'video-vault' });
    await this.db.clearAttemptsCountByUsername({ username });
    return token;
  }
}

export { AuthService };
