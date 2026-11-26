import type { Bootstrap } from './types';

interface SessionInfo {
  authenticated: boolean;
  csrfToken: string;
  expiresAt: number | null;
}

const SESSION = 'videovault.session';
const BOOTSTRAP = 'videovault.bootstrap';
let csrfToken = '';
let pendingSession: Promise<SessionInfo> | undefined;

class ApiError extends Error {
  constructor(public status: number) {
    super(String(status));
  }
}

/** Stores only public expiry metadata. The authentication cookie remains inaccessible to JavaScript. */
const rememberSession = function (info: SessionInfo): void {
  csrfToken = info.csrfToken;
  if (info.authenticated && info.expiresAt) localStorage.setItem(SESSION, JSON.stringify({ expiresAt: info.expiresAt }));
  else localStorage.removeItem(SESSION);
};

const clearSession = function (): void {
  csrfToken = '';
  localStorage.removeItem(SESSION);
  window.dispatchEvent(new Event('vault:unauthorized'));
};

const sessionInfo = async function (): Promise<SessionInfo> {
  pendingSession ??= fetch('/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status);
    const info: SessionInfo = await response.json();
    rememberSession(info);
    return info;
  }).finally(() => { pendingSession = undefined; });
  return pendingSession;
};

const sessionValid = function (): boolean {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION) ?? 'null');
    return typeof value?.expiresAt === 'number' && value.expiresAt > Date.now();
  } catch {
    return false;
  }
};

const request = async function (path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase())) {
    if (path === '/login' || !csrfToken) await sessionInfo();
    headers.set('X-CSRF-Token', csrfToken);
  }
  const result = await fetch(path, { ...init, headers, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  if (result.status === 401) clearSession();
  if (!result.ok) throw new ApiError(result.status);
  return result;
};

const json = async function <T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
  const result = response.status === 204 ? undefined : await response.json();
  if (path === '/login') rememberSession(result);
  return result as T;
};

const logout = async function (everywhere = false): Promise<void> {
  try {
    await json(everywhere ? '/api/logout-everywhere' : '/api/logout', undefined, 'POST');
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
  clearSession();
};

const upload = async function (path: string, data: FormData, onProgress: (progress: number) => void): Promise<void> {
  if (!csrfToken) await sessionInfo();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total); };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      if (xhr.status === 401) clearSession();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status));
    };
    xhr.onerror = () => reject(new TypeError('Upload failed'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
    xhr.send(data);
  });
};

const bootstrap = async function (refresh = false): Promise<Bootstrap> {
  const cached = localStorage.getItem(BOOTSTRAP);
  if (cached && !refresh) {
    try {
      return validate(JSON.parse(cached));
    } catch {
      localStorage.removeItem(BOOTSTRAP);
    }
  }
  const result = validate(await json('/bootstrap'));
  localStorage.setItem(BOOTSTRAP, JSON.stringify(result));
  return result;
};

const validate = function (value: unknown): Bootstrap {
  const b = value as Bootstrap;
  if (
    !b ||
    b.version !== 1 ||
    !/^[a-f0-9]{64}$/i.test(b.instanceSalt) ||
    typeof b.app?.title !== 'string' ||
    !Array.isArray(b.meta?.fields) ||
    !Array.isArray(b.meta?.sorting) ||
    typeof b.meta.recorded?.withTime !== 'boolean' ||
    typeof b.meta.recorded?.useAsFilter !== 'boolean'
  )
    throw new Error('configuration');
  const keys = new Set<string>();
  for (const field of b.meta.fields) {
    if (
      !field || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.key) || ['constructor', 'prototype'].includes(field.key) || keys.has(field.key) || !['text', 'number', 'boolean', 'date', 'datetime'].includes(field.type) || !['multiple', 'required', 'showInDetails', 'useAsFilter'].every(
        (flag) => typeof field[flag as keyof typeof field] === 'boolean'
      ) ||
      (field.type === 'boolean' && field.multiple)
    )
      throw new Error('configuration');
    if (
      !field.name ||
      typeof field.name !== 'object' ||
      Array.isArray(field.name) ||
      Object.keys(field.name).length !== 2 ||
      ![field.name.de, field.name.en].every(
        (name) => name.trim().length > 0 && name.length <= 100
      )
    )
      throw new Error('configuration');
    // noinspection SuspiciousTypeOfGuard
    if (
      field.options !== undefined &&
      (field.type !== 'text' ||
        !Array.isArray(field.options) ||
        field.options.length < 1 ||
        field.options.length > 100 ||
        field.options.some(
          (option) => typeof option !== 'string' || !option.trim() || option !== option.trim() || option.length > 100
        ) ||
        new Set(field.options).size !== field.options.length)
    )
      throw new Error('configuration');
    keys.add(field.key);
  }
  const sorting = new Set<string>();
  for (const sort of b.meta.sorting) {
    if (!sort || !['title', 'recorded', 'meta'].includes(sort.source) || !['asc', 'desc'].includes(sort.direction))
      throw new Error('configuration');
    const id = sort.source === 'meta' ? `meta:${sort.key}` : sort.source;
    if (sorting.has(id) || (sort.source === 'meta' && !keys.has(sort.key))) throw new Error('configuration');
    sorting.add(id);
  }
  return b;
};

export { SESSION, BOOTSTRAP, ApiError, clearSession, request, json, upload, bootstrap, sessionInfo, sessionValid, logout };
