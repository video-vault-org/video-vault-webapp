import { useEffect, useState } from 'react';
import type { Bootstrap, Keys, PlainVideo, User } from '../lib/types';
import { mediaUrl } from '../lib/mediaBridge';
import { json } from '../lib/api';
import { formatValue } from '../lib/catalog';
import { Dialog, ErrorMessage, useLanguage, useTask } from '../lib/ui';
import { Comments } from './Comments';

const VideoOverlay = function ({
  video,
  config,
  keys,
  user,
  close,
  edit,
  removed
}: {
  video: PlainVideo;
  config: Bootstrap;
  keys: Keys;
  user: User;
  close: () => void;
  edit: () => void;
  removed: () => Promise<void>;
}) {
  const { t, language } = useLanguage(),
    task = useTask();
  const [src, setSrc] = useState(''),
    [comments, setComments] = useState(false);

  useEffect(() => {
    let disposed = false,
      release: (() => void) | undefined;
    void task.run(async () => {
      const result = await mediaUrl(video, keys);
      if (disposed) result.dispose();
      else {
        release = result.dispose;
        setSrc(result.url);
      }
    });
    return () => {
      disposed = true;
      release?.();
    };
  }, [video.videoId, video.lastModified]);

  return (
    <>
      <Dialog title={video.plainTitle} close={close}>
        <div className="video-stage">
          {src ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={src}
              onError={() =>
                task.setError(
                  t(
                    'Wiedergabe fehlgeschlagen. Verbindung oder Dateiformat prüfen.',
                    'Playback failed. Check the connection or file format.'
                  )
                )
              }
            />
          ) : (
            <p>{t('Player wird vorbereitet …', 'Preparing player …')}</p>
          )}
        </div>
        <iframe name="vault-download" title={t('Download', 'Download')} hidden />
        <ErrorMessage text={task.error} />
        <div className="actions">
          {src && (
            <a className="button" href={`${src}?download=1`} target="vault-download">
              {t('Herunterladen', 'Download')}
            </a>
          )}
          <button onClick={() => setComments(true)}>{t('Kommentare', 'Comments')}</button>
          <button disabled={!user.editor || task.pending} onClick={edit}>
            {t('Bearbeiten', 'Edit')}
          </button>
          <button
            className="danger"
            disabled={!user.editor || task.pending}
            onClick={() => {
              if (
                confirm(
                  t(
                    'Video mit Dateien und Kommentaren endgültig löschen?',
                    'Permanently delete this video, its files and comments?'
                  )
                )
              )
                void task.run(async () => {
                  await json(`/api/video/delete/${video.videoId}`, undefined, 'DELETE');
                  await removed();
                  close();
                });
            }}
          >
            {t('Löschen', 'Delete')}
          </button>
        </div>
        <p className="recorded">
          {formatValue(video.recorded, { type: config.meta.recorded.withTime ? 'datetime' : 'date' }, language)}
        </p>
        <p className="prewrap">{video.plainDescription}</p>
        <dl className="details">
          {config.meta.fields
            .filter((f) => f.showInDetails)
            .map((f) => (
              <div key={f.key}>
                <dt>{f.name}</dt>
                <dd>{formatValue(video.meta[f.key], f, language)}</dd>
              </div>
            ))}
        </dl>
        <small className="muted">
          {t(
            'Downloads und Wiedergabe benötigen eine Verbindung und diese geöffnete, entsperrte App.',
            'Downloads and playback require a connection and this open, unlocked app.'
          )}
        </small>
      </Dialog>
      {comments && <Comments videoId={video.videoId} keys={keys} user={user} close={() => setComments(false)} />}
    </>
  );
};

export { VideoOverlay };
