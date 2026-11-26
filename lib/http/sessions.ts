import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, AuthenticatedSession } from '@/service/AuthService';
import { HttpError } from './errors';

/** Exact cookie parsing rejects duplicate credentials rather than selecting an ambiguous value. */
const cookie = function (request: FastifyRequest, name: string): string {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
};

const equal = function (left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const loopback = function (value: string): boolean {
  return value === 'localhost' || value === '::1' || value === '[::1]' || (isIP(value) === 4 && value.startsWith('127.')) || (isIP(value) === 6 && /^::ffff:127\./.test(value));
};

/** HttpOnly host-only cookies and session-bound header tokens protect every unsafe request, including login and uploads. */
const sessionSecurity = function (auth: AuthService, insecureLocalCookies: boolean) {
  const sessionName = insecureLocalCookies ? 'videovault-local-session' : '__Host-videovault-session';
  const challengeName = insecureLocalCookies ? 'videovault-local-challenge' : '__Host-videovault-challenge';
  const challengeKey = randomBytes(32);

  const localOnly = function (request: FastifyRequest): void {
    if (insecureLocalCookies && (!loopback(request.socket.remoteAddress ?? '') || !loopback(request.hostname))) throw new HttpError(403, 'Development cookies require a loopback connection and hostname');
  };

  const setCookies = function (reply: FastifyReply, values: string[]): void {
    reply.header('Set-Cookie', values);
  };

  const serialize = function (name: string, value: string, maxAge: number): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, maxAge)}${insecureLocalCookies ? '' : '; Secure'}`;
  };

  const credential = function (request: FastifyRequest): string {
    localOnly(request);
    return cookie(request, sessionName);
  };

  const clear = function (reply: FastifyReply): void {
    setCookies(reply, [serialize(sessionName, '', 0), serialize(challengeName, '', 0)]);
  };

  const issue = function (reply: FastifyReply, sessionId: string, expiresAt: number): void {
    setCookies(reply, [serialize(sessionName, sessionId, Math.ceil((expiresAt - Date.now()) / 1000)), serialize(challengeName, '', 0)]);
  };

  const signature = function (value: string): string {
    return createHmac('sha256', challengeKey).update(value).digest('base64url');
  };

  const challenge = function (reply: FastifyReply): string {
    const value = `${Date.now() + 600_000}.${randomBytes(32).toString('base64url')}`;
    const secret = `${value}.${signature(value)}`;
    setCookies(reply, [serialize(challengeName, secret, 600)]);
    return auth.csrfToken(secret);
  };

  const verify = function (request: FastifyRequest, session?: AuthenticatedSession | null): void {
    localOnly(request);
    const site = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    if (site === 'cross-site' || (origin && origin !== `${request.protocol}://${request.host}`)) throw new HttpError(403, 'Cross-origin request rejected');
    let expected = session?.csrfToken ?? '';
    if (!expected) {
      const secret = cookie(request, challengeName);
      const [expiry, nonce, signed, extra] = secret.split('.');
      if (extra === undefined && /^\d{13}$/.test(expiry ?? '') && /^[A-Za-z0-9_-]{43}$/.test(nonce ?? '') && Number(expiry) > Date.now() && Number(expiry) <= Date.now() + 600_000 && equal(signed ?? '', signature(`${expiry}.${nonce}`)))
        expected = auth.csrfToken(secret);
    }
    const supplied = request.headers['x-csrf-token'];
    if (!expected || typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !equal(supplied, expected)) throw new HttpError(403, 'Invalid CSRF token');
  };

  return { credential, clear, issue, challenge, verify, cookieName: sessionName };
};

export { sessionSecurity, loopback };
