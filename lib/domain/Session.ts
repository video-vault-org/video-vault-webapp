/** A server-side session. Only the SHA-256 digest of the random browser credential is stored. */
interface Session {
  sessionId: string;
  userId: string;
  /** Hash binding the user's current credentials and explicit revocation version. */
  version: string;
  expiresAt: number;
}

export { Session };
