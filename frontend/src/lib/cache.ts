import type { Video } from './types';
let database: Promise<IDBDatabase> | undefined;

const db = function () {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('videovault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('data');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      database = undefined;
      reject(r.error);
    };
  }));
};

const get = async function <T>(key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('data').objectStore('data').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};

const put = async function (key: string, value: unknown): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const t = database.transaction('data', 'readwrite');

    t.objectStore('data').put(value, key);

    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

const removePrefix = async function (prefix: string): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const t = database.transaction('data', 'readwrite'),
      store = t.objectStore('data'),
      r = store.openKeyCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (cursor) {
        if (String(cursor.key).startsWith(prefix)) store.delete(cursor.key);
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
};

interface Catalog {
  videos: Video[];
  since: string;
}

/** One atomic record holds ciphertext and high-water mark. No decrypted title/description is accepted by callers. */
const mergeCatalog = function (previous: Catalog, updates: Video[], currentIds: string[]): Catalog {
  const allowed = new Set(currentIds),
    map = new Map(previous.videos.filter((v) => allowed.has(v.videoId)).map((v) => [v.videoId, v]));
  let since = previous.since;
  for (const video of updates) {
    if (allowed.has(video.videoId)) map.set(video.videoId, video);
    if (Date.parse(video.lastModified) > Number(since)) since = String(Date.parse(video.lastModified));
  }
  return { videos: [...map.values()], since };
};

const emptyCatalog = (): Catalog => ({ videos: [], since: '0' });

export { get, put, removePrefix, Catalog, mergeCatalog, emptyCatalog };
