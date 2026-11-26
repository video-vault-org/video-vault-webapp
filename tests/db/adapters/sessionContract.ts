import { DatabaseAdapter } from '@/db/adapters/DatabaseAdapter';

/** Shared persistence contract, executed against each real adapter. */
const sessionContract = function (database: () => DatabaseAdapter): void {
  test('stores credential digests, finds and deletes one session without affecting another', async () => {
    const db = database();
    const first = { sessionId: 'a'.repeat(64), userId: 'session-user', version: '', expiresAt: Date.now() + 3600_000 };
    const second = { ...first, sessionId: 'b'.repeat(64) };
    expect(await db.findSessionById({ sessionId: first.sessionId })).toBeNull();
    await db.createSession(first);
    await db.createSession(second);
    expect(await db.findSessionById({ sessionId: first.sessionId })).toEqual(first);
    await db.deleteSessionById({ sessionId: first.sessionId });
    await db.deleteSessionById({ sessionId: first.sessionId });
    expect(await db.findSessionById({ sessionId: first.sessionId })).toBeNull();
    expect(await db.findSessionById({ sessionId: second.sessionId })).toEqual(second);
  });

  test('atomically replaces persistent per-user revocation versions without affecting other users', async () => {
    const db = database();
    expect(await db.findSessionVersionByUserId({ userId: 'session-user' })).toBe('');
    await db.changeSessionVersionByUserId({ userId: 'session-user', version: 'first' });
    await db.changeSessionVersionByUserId({ userId: 'other-session-user', version: 'other' });
    await db.changeSessionVersionByUserId({ userId: 'session-user', version: 'second' });
    expect(await db.findSessionVersionByUserId({ userId: 'session-user' })).toBe('second');
    expect(await db.findSessionVersionByUserId({ userId: 'other-session-user' })).toBe('other');
  });
};

export { sessionContract };
