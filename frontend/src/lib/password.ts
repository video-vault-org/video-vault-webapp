import { base64, random, utf8 } from './crypto';

interface Invitation {
  type: 'invite' | 'reset';
  username: string;
  password: string;
}

const passwordProblems = function (password: string): ('length' | 'categories')[] {
  const problems: ('length' | 'categories')[] = [];
  if (Array.from(password).length < 12 || password.length > 4096) problems.push('length');
  if ([/\p{Lu}/u, /\p{Ll}/u, /\p{N}/u, /[^\p{L}\p{N}\s]/u].filter((r) => r.test(password)).length < 3)
    problems.push('categories');
  return problems;
};

/** Only the five-hex SHA-1 prefix is transmitted. Never query while typing. SHA-1 is used solely for HIBP lookup. */
const pwned = async function (password: string): Promise<'safe' | 'breached' | 'unavailable'> {
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', utf8(password))), (n) =>
      n.toString(16).padStart(2, '0')
    )
      .join('')
      .toUpperCase();
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return 'unavailable';
    const text = await response.text();
    return text.split(/\r?\n/).some((line) => {
      const [suffix, count] = line.split(':');
      return suffix === hash.slice(5) && Number(count) > 0;
    })
      ? 'breached'
      : 'safe';
  } catch {
    return 'unavailable';
  }
};

const temporaryPassword = () => `Aa1!${base64(random(24))}`;

const inviteLink = function (value: Invitation): string {
  return `${location.origin}/#${base64(utf8(JSON.stringify(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;
};

/** Scrub fragment before parsing it; invitation passwords never enter localStorage or API URLs. */
const readInvitation = function (): Invitation | null {
  const hash = location.hash.slice(1);
  if (!hash) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
      )
    );
    if (
      !['invite', 'reset'].includes(data.type) ||
      typeof data.username !== 'string' ||
      data.username.length < 3 ||
      typeof data.password !== 'string' ||
      data.password.length > 4096
    )
      return null;
    return data;
  } catch {
    return null;
  }
};

export { passwordProblems, pwned, temporaryPassword, Invitation, inviteLink, readInvitation };
