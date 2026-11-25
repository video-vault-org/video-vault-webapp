import { useState, useRef, useId, useEffect } from 'react';
import type { Bootstrap, Keys, PlainVideo, Video } from '../lib/types';
import { Dialog, Field, ErrorMessage, useLanguage, useTask } from '../lib/ui';
import { MetadataFields, validateMetadata } from './MetadataFields';
import { Compatibility } from './Compatibility';
import { inspect, type MediaReport } from '../lib/compatibility';
import { encryptText, sign, verify } from '../lib/crypto';
import { json } from '../lib/api';
import { uploadFiles } from '../lib/uploadFiles';

const VideoForm = function ({
  existing,
  config,
  keys,
  close,
  saved
}: {
  existing?: PlainVideo;
  config: Bootstrap;
  keys: Keys;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { t } = useLanguage(),
    task = useTask();
  const initialRecorded = existing
    ? config.meta.recorded.withTime
      ? new Date(Date.parse(existing.recorded) - new Date(existing.recorded).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 19)
      : existing.recorded.slice(0, 10)
    : '';
  const [title, setTitle] = useState(existing?.plainTitle ?? ''),
    [description, setDescription] = useState(existing?.plainDescription ?? ''),
    [recorded, setRecorded] = useState(initialRecorded),
    [meta, setMeta] = useState(existing?.meta ?? {}),
    [video, setVideo] = useState<File>(),
    [thumbnail, setThumbnail] = useState<File>(),
    [report, setReport] = useState<MediaReport>(),
    [analysis, setAnalysis] = useState(false),
    [progress, setProgress] = useState('');
  const selection = useRef(0);
  const transfer = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => transfer.current?.abort(), []);

  const videoHintId = useId();
  const thumbnailHintId = useId();

  const selected = async function (file: File | undefined) {
    const version = ++selection.current;
    setVideo(file);
    setReport(undefined);
    if (!file) {
      setAnalysis(false);
      return;
    }
    setAnalysis(true);
    try {
      const value = await inspect(file);
      if (version === selection.current) setReport(value);
    } catch {
      task.setError(
        t(
          'Medienanalyse fehlgeschlagen. Kompatibilität unbekannt; du kannst fortfahren.',
          'Media analysis failed. Compatibility is unknown; you may proceed.'
        )
      );
    } finally {
      if (version === selection.current) setAnalysis(false);
    }
  };

  const submit = async function () {
    await task.run(async () => {
      const videoId = existing?.videoId ?? crypto.randomUUID();
      let state: Video = existing
        ? await json<Video>(`/api/video/find/${videoId}`)
        : {
            videoId,
            title: '',
            description: '',
            meta: {},
            videoMimeType: '',
            thumbnailMimeType: '',
            recorded: new Date(recorded).toISOString(),
            lastModified: new Date().toISOString(),
            hmac: '',
            deleted: false
          };
      if (existing) await verify(state, keys);
      const metadata = validateMetadata(config.meta.fields, meta);

      const touch = () => {
        state.lastModified = new Date().toISOString();
      };

      if (video || thumbnail) {
        const files: { kind: 'video' | 'thumbnail'; file: File }[] = [];
        if (video) files.push({ kind: 'video', file: video });
        if (thumbnail) files.push({ kind: 'thumbnail', file: thumbnail });
        const controller = new AbortController();
        transfer.current = controller;
        try {
          await uploadFiles({
            videoId,
            files,
            key: keys.encryption,
            signal: controller.signal,
            onProgress: ({ encrypted, uploaded }) => setProgress(
              `${t('Verschlüsseln', 'Encrypting')}: ${Math.floor(encrypted * 100)}% · ${t('Hochladen', 'Uploading')}: ${Math.floor(uploaded * 100)}%`
            )
          });
        } finally {
          transfer.current = undefined;
        }
        setProgress(t('Speichern …', 'Saving …'));
        state.videoMimeType = video ? report?.mime || video.type || 'application/octet-stream' : state.videoMimeType;
        state.thumbnailMimeType = thumbnail ? thumbnail.type || 'image/jpeg' : state.thumbnailMimeType;
        if (existing) {
          touch();
          state.hmac = await sign(state, keys);
          await json(
            `/api/video/change/files/${videoId}`,
            {
              ...(video ? { videoMimeType: state.videoMimeType } : {}),
              ...(thumbnail ? { thumbnailMimeType: state.thumbnailMimeType } : {}),
              lastModified: state.lastModified,
              hmac: state.hmac
            },
            'PATCH'
          );
        }
      }
      if (!existing) {
        state.title = await encryptText(title, 'title', videoId, keys);
        state.description = await encryptText(description, 'description', videoId, keys);
        state.meta = metadata;
        touch();
        state.hmac = await sign(state, keys);
        await json('/api/video/submit', state);
      } else {
        const changes: [string, string, unknown][] = [];
        if (title !== existing.plainTitle)
          changes.push(['title', 'title', await encryptText(title, 'title', videoId, keys)]);
        if (description !== existing.plainDescription)
          changes.push(['description', 'description', await encryptText(description, 'description', videoId, keys)]);
        if (JSON.stringify(metadata) !== JSON.stringify(existing.meta)) changes.push(['metadata', 'meta', metadata]);
        const date = new Date(recorded).toISOString();
        if (recorded !== initialRecorded) changes.push(['recorded', 'recorded', date]);
        for (const [route, property, value] of changes) {
          state = { ...state, [property]: value };
          touch();
          state.hmac = await sign(state, keys);
          await json(
            `/api/video/change/${route}/${videoId}`,
            { [route]: value, lastModified: state.lastModified, hmac: state.hmac },
            'PATCH'
          );
        }
      }
      await saved();
      close();
    });
    setProgress('');
  };

  return (
    <Dialog title={existing ? t('Video bearbeiten', 'Edit video') : t('Video hinzufügen', 'Add video')} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={task.pending}>
          <div className="form-grid">
            <Field label={t('Titel', 'Title')}>
              <input required value={title} maxLength={512} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t('Aufgezeichnet', 'Recorded')}>
              <input
                required
                type={config.meta.recorded.withTime ? 'datetime-local' : 'date'}
                step={config.meta.recorded.withTime ? '1' : undefined}
                value={recorded}
                onChange={(e) => setRecorded(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('Beschreibung', 'Description')}>
            <textarea
              value={description}
              maxLength={200000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <MetadataFields fields={config.meta.fields} value={meta} onChange={setMeta} />
          <div className="form-grid">
            <div>
              <Field
                label={
                  existing
                    ? t('Videodatei ersetzen (optional)', 'Replace video file (optional)')
                    : t('Videodatei', 'Video file')
                }
              >
                <input
                  type="file"
                  accept="video/*,.mkv,.mov,.mp4,.webm"
                  required={!existing}
                  aria-describedby={videoHintId}
                  onChange={(e) => void selected(e.target.files?.[0])}
                />
              </Field>
              <small id={videoHintId} className="muted">
                {t(
                  'Für breite Browser-Unterstützung empfohlen: MP4 - Web Optimized (H.264/AVC (x264), Profil Main oder High, Level 4.1, 8 Bit / 4:2:0, maximal 1080p und 30 fps, AAC Stereo)',
                  'Recommended for broad browser support: MP4 - Web Optimized (H.264/AVC (x264), Main or High profile, level 4.1, 8-bit / 4:2:0, at most 1080p and 30 fps, AAC stereo)'
                )}
              </small>
            </div>
            <div>
              <Field
                label={
                  existing
                    ? t('Thumbnail ersetzen (optional)', 'Replace thumbnail (optional)')
                    : t('Thumbnail', 'Thumbnail')
                }
              >
                <input
                  type="file"
                  accept="image/*"
                  required={!existing}
                  aria-describedby={thumbnailHintId}
                  onChange={(e) => setThumbnail(e.target.files?.[0])}
                />
              </Field>
              <small id={thumbnailHintId} className="muted">
                {t(
                  'Empfohlen: 1280 × 720 Pixel (16:9), WebP oder JPEG, Qualität ca. 80–85 %, möglichst unter 200 KB. Andere Seitenverhältnisse werden beschnitten. Wichtige Bildinhalte und Text mit Abstand zum Rand platzieren.',
                  'Recommended: 1280 × 720 pixels (16:9), WebP or JPEG, quality around 80–85%, ideally below 200 KB. Other aspect ratios are cropped. Keep important content and text away from the edges.'
                )}
              </small>
            </div>
          </div>
          {analysis && (
            <p role="status">{t('Container und Codecs werden geprüft …', 'Checking container and codecs …')}</p>
          )}
          {report && <Compatibility report={report} />}
          <p className="muted">
            {t(
              'Dateien werden im Browser paketweise verschlüsselt und hochgeladen. Änderungen werden schrittweise gespeichert; bei Fehlern können Teiländerungen bestehen bleiben.',
              'Files are encrypted and uploaded in packets in your browser. Changes are saved in steps; errors may leave partial changes.'
            )}
          </p>
          <ErrorMessage text={task.error} />
          {progress && <p role="status">{progress}</p>}
          <button className="primary" disabled={analysis || task.pending}>
            {task.pending ? t('Speichern …', 'Saving …') : t('Speichern', 'Save')}
          </button>
        </fieldset>
      </form>
    </Dialog>
  );
};

export { VideoForm };
