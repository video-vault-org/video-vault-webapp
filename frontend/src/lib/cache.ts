import type { Video } from './types';

interface Catalog {
  videos: Video[];
  since: string;
}

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

/** One atomic record holds ciphertext and high-water mark. No decrypted title/description is accepted by callers. */
const mergeCatalog = function (previous: Catalog, updates: Video[]): Catalog {
  const map = new Map(previous.videos.filter((video) => !video.deleted).map((video) => [video.videoId, video]));
  let since = previous.since;
  for (const video of updates) {
    if (video.deleted) map.delete(video.videoId);
    else map.set(video.videoId, video);
    if (Date.parse(video.lastModified) > Number(since)) since = String(Date.parse(video.lastModified));
  }
  return { videos: [...map.values()], since };
};

/** Atomically persists the ciphertext catalog and its watermark, and removes thumbnails for received tombstones. */
const saveCatalog = async function (namespace: string, catalog: Catalog, deletedIds: string[]): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('data', 'readwrite');
    const store = transaction.objectStore('data');
    store.put(catalog, namespace + 'catalog');
    for (const videoId of deletedIds) store.delete(namespace + 'thumb:' + videoId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

/** A late thumbnail response must not recreate a cached thumbnail after deletion or an update. */
const saveThumbnail = async function (namespace: string, videoId: string, version: string, bytes: Blob): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('data', 'readwrite');
    const store = transaction.objectStore('data');
    const request = store.get(namespace + 'catalog');
    request.onsuccess = () => {
      const catalog = request.result as Catalog | undefined;
      if (
        catalog?.videos.some((video) => video.videoId === videoId && !video.deleted && video.lastModified === version)
      ) {
        store.put({ version, bytes }, namespace + 'thumb:' + videoId);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

const emptyCatalog = (): Catalog => ({ videos: [], since: '0' });

export { get, put, removePrefix, Catalog, mergeCatalog, saveCatalog, saveThumbnail, emptyCatalog };
