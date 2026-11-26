import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';
import { User } from '@/domain/User';
import { hashPassword, verifyPassword } from '@/util/password';

interface AuthenticatedSession {
  user: User;
  expiresAt: number;
  csrfToken: string;
}

/** Persistent opaque sessions; credential checks share a per-username lock within this process. */
class AuthService {
  private readonly pendingLogins = new Map<string, Promise<unknown>>();
  private readonly db: DatabaseAdapter;
  private readonly sessionLifetimeSeconds: number;
  private initialization: Promise<void> | null = null;
  private dummyPasswordHash = '';

  /** Sessions have a fixed, server-enforced lifetime, defaulting to one hour. */
  public constructor(db: DatabaseAdapter, { sessionLifetimeSeconds = 3600 }: { sessionLifetimeSeconds?: number } = {}) {
    if (!Number.isSafeInteger(sessionLifetimeSeconds) || sessionLifetimeSeconds <= 0 || sessionLifetimeSeconds > 31_536_000) throw new RangeError('Invalid sessionLifetimeSeconds');
    this.db = db;
    this.sessionLifetimeSeconds = sessionLifetimeSeconds;
  }

  /** Prepares constant-work verification for unknown usernames. Repeated calls share initialization. */
  public async initialize(): Promise<void> {
    this.initialization ??= hashPassword(randomBytes(32).toString('base64'))
      .then((hash) => {
        this.dummyPasswordHash = hash;
      })
      .catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    await this.initialization;
  }

  /**
   * Verifies the client loginHash as a password and creates a fresh random session; returns null for invalid or locked credentials.
   * Failure 5 locks for 15 seconds; each later failure after expiry doubles the lock up to 15 minutes.
   * Attempts during a lock restart its duration without increasing the counter; successful login clears it.
   * Credentials checks are serialized per username in this instance. Separate processes are not coordinated.
   */
  public async login({ username, loginHash }: { username: string; loginHash: string }): Promise<string | null> {
    this.requireInitialized();
    return this.serializeCredentials(username, async () => {
      const user = await this.checkCredentials(username, loginHash);
      if (!user) return null;
      const sessionId = randomBytes(32).toString('base64url');
      const version = await this.db.findSessionVersionByUserId({ userId: user.userId });
      await this.db.createSession({ sessionId: this.digest(sessionId), userId: user.userId, version, expiresAt: Date.now() + this.sessionLifetimeSeconds * 1000 });
      await this.db.clearAttemptsCountByUsername({ username });
      return sessionId;
    });
  }

  /** Checks the current password without issuing a session, using the same failed-attempt lock as login. */
  public async verifyCurrentPassword({ userId, loginHash }: { userId: string; loginHash: string }): Promise<boolean> {
    this.requireInitialized();
    const current = await this.db.findOneUserByUserId({ userId });
    if (!current) return false;
    return this.serializeCredentials(current.username, async () => {
      const user = await this.checkCredentials(current.username, loginHash, userId);
      if (!user) return false;
      await this.db.clearAttemptsCountByUsername({ username: current.username });
      return true;
    });
  }

  /** Loads the current user; expired, revoked, malformed and deleted-user sessions return null. */
  public async authenticate({ sessionId }: { sessionId: string }): Promise<User | null> {
    return (await this.findSession({ sessionId }))?.user ?? null;
  }

  /** Validates expiry and the strongly read revocation version, then loads current roles from the user record. */
  public async findSession({ sessionId }: { sessionId: string }): Promise<AuthenticatedSession | null> {
    this.requireInitialized();
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return null;
    const session = await this.db.findSessionById({ sessionId: this.digest(sessionId) });
    if (!session) return null;
    if (session.expiresAt <= Date.now() || session.version !== (await this.db.findSessionVersionByUserId({ userId: session.userId }))) {
      await this.logout({ sessionId });
      return null;
    }
    const user = await this.db.findOneUserByUserId({ userId: session.userId });
    if (!user) {
      await this.logout({ sessionId });
      return null;
    }
    return { user, expiresAt: session.expiresAt, csrfToken: this.csrfToken(sessionId) };
  }

  /** Revokes only this browser credential. Idempotent, including unknown credentials. */
  public async logout({ sessionId }: { sessionId: string }): Promise<void> {
    await this.db.deleteSessionById({ sessionId: this.digest(sessionId) });
  }

  /** Atomically invalidates all previously issued sessions for this user, including this browser. */
  public async logoutEverywhere({ userId }: { userId: string }): Promise<void> {
    await this.db.changeSessionVersionByUserId({ userId, version: randomUUID() });
  }

  /** Derives a separate CSRF token; it cannot be used as a session credential. Also used for pre-login challenges. */
  public csrfToken(sessionId: string): string {
    return createHmac('sha256', sessionId).update('video-vault:csrf:v1').digest('base64url');
  }

  /** Returns current enabled roles; roles are never taken from browser credentials. */
  public authorize(user: User): ('admin' | 'editor' | 'moderator')[] {
    const roles: ('admin' | 'editor' | 'moderator')[] = [];
    if (user.admin) roles.push('admin');
    if (user.editor) roles.push('editor');
    if (user.moderator) roles.push('moderator');
    return roles;
  }

  private digest(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex');
  }

  private requireInitialized(): void {
    if (!this.dummyPasswordHash) throw new Error('AuthService is not initialized');
  }

  private async serializeCredentials<T>(username: string, action: () => Promise<T>): Promise<T> {
    // noinspection ES6MissingAwait promise is handled later
    const previous = this.pendingLogins.get(username) ?? Promise.resolve();
    const current = previous.catch(() => null).then(action);
    this.pendingLogins.set(username, current);
    try {
      return await current;
    } finally {
      if (this.pendingLogins.get(username) === current) this.pendingLogins.delete(username);
    }
  }

  private async checkCredentials(username: string, loginHash: string, userId?: string): Promise<User | null> {
    const attempts = await this.db.findOneAttemptsCountByUsername({ username });
    const now = new Date();
    const duration = attempts && attempts.attempts >= 5 ? Math.min(15_000 * 2 ** Math.min(attempts.attempts - 5, 6), 900_000) : 0;
    if (attempts && duration > 0 && now.getTime() < attempts.lastAttempt.getTime() + duration) {
      await this.db.changeAttemptsLastAttemptByUsername({ username, lastAttempt: now });
      return null;
    }
    const user = await this.db.findOneUserByUsername({ username });
    const matches = await verifyPassword(loginHash, user?.loginHash ?? this.dummyPasswordHash);
    if (!user || !matches || (userId !== undefined && user.userId !== userId)) {
      await this.db.increaseAttemptsCountByUsername({ username, lastAttempt: new Date() });
      return null;
    }
    return user;
  }
}

export { AuthService, AuthenticatedSession };
