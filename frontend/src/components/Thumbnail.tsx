import { useEffect, useState, useRef } from 'react';
import { get, saveThumbnail } from '../lib/cache';
import { request } from '../lib/api';
import { decrypt } from '../lib/crypto';
import type { Keys, Video } from '../lib/types';
import { useLanguage } from '../lib/ui';

const Thumbnail = function ({ video, keys, namespace }: { video: Video; keys: Keys; namespace: string }) {
  const [src, setSrc] = useState(''),
    [failed, setFailed] = useState(false),
    { t } = useLanguage();
  const element = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false,
      url = '';

    const load = async function () {
      const id = `${namespace}thumb:${video.videoId}`,
        cached = await get<{ version: string; bytes: Blob }>(id);
      let data = cached?.version === video.lastModified ? cached.bytes : undefined;
      if (!data) {
        data = await (await request(`/api/video/thumbnail/${video.videoId}`)).blob();
        await saveThumbnail(namespace, video.videoId, video.lastModified, data);
      }
      const plain = await decrypt(data, 'thumbnail', `${video.videoId}.thumbnail`, keys);
      url = URL.createObjectURL(
        new Blob([plain], {
          type: /^image\/(jpeg|png|webp|avif|gif)$/.test(video.thumbnailMimeType)
            ? video.thumbnailMimeType
            : 'application/octet-stream'
        })
      );
      if (!cancelled) setSrc(url);
      else URL.revokeObjectURL(url);
    };

    setFailed(false);
    setSrc('');
    void load().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video.videoId, video.lastModified, keys, namespace, visible]);

  return (
    <div ref={element} className="thumbnail-frame">
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <div
          className="thumbnail-placeholder"
          aria-label={
            failed
              ? t('Vorschaubild nicht verfügbar', 'Thumbnail unavailable')
              : t('Vorschaubild wird geladen', 'Loading thumbnail')
          }
        >
          <span>▷</span>
        </div>
      )}
    </div>
  );
};

export { Thumbnail };
