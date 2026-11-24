import type { Bootstrap } from './types';

const TOKEN = 'videovault.token',
  BOOTSTRAP = 'videovault.bootstrap';
class ApiError extends Error {
  constructor(public status: number) {
    super(String(status));
  }
}

const clearToken = function () {
  localStorage.removeItem(TOKEN);
  window.dispatchEvent(new Event('vault:unauthorized'));
};

const request = async function (path: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(TOKEN);
  if (path.startsWith('/api/') && !token) {
    clearToken();
    throw new ApiError(401);
  }
  const headers = new Headers(init.headers);
  if (token && path.startsWith('/api/')) headers.set('Authorization', `Bearer ${token}`);
  const result = await fetch(path, { ...init, headers, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (result.status === 401) clearToken();
  if (!result.ok) throw new ApiError(result.status);
  return result;
};

const json = async function <T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST'
): Promise<T> {
  const response = await request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  });
  return response.status === 204 ? (undefined as T) : response.json();
};

const upload = async function (path: string, data: FormData, onProgress: (progress: number) => void): Promise<void> {
  const token = localStorage.getItem(TOKEN);
  if (!token) {
    clearToken();
    throw new ApiError(401);
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      if (xhr.status === 401) clearToken();
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
      field.options !== undefined &&
      (field.type !== 'text' ||
        !Array.isArray(field.options) ||
        field.options.length < 1 ||
        field.options.length > 100 ||
        field.options.some(
          (option) => !option.trim() || option !== option.trim() || option.length > 100
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

const tokenValid = function (token: string): boolean {
  try {
    const data = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof data.exp === 'number' && data.exp * 1000 > Date.now();
  } catch {
    return false;
  }
};

export { TOKEN, BOOTSTRAP, ApiError, clearToken, request, json, upload, bootstrap, tokenValid };
