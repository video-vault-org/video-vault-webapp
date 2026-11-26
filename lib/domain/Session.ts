/** A server-side session. Only the SHA-256 digest of the random browser credential is stored. */
interface Session {
  sessionId: string;
  userId: string;
  version: string;
  expiresAt: number;
}

export { Session };
