import type { MediaReport } from '../lib/compatibility';
import { useLanguage } from '../lib/ui';

const Compatibility = function ({ report }: { report: MediaReport }) {
  const { t } = useLanguage();
  const problems: Record<string, string> = {
    'level-unknown': t(
      'H.264-Level nicht erkannt. Kompatibilität ist unsicher.',
      'H.264 level not recognized. Compatibility is uncertain.'
    ),
    container: t('Container außerhalb von MP4/WebM.', 'Container is neither MP4 nor WebM.'),
    codec: t(
      'Video ist nicht H.264/AVC. Unterstützung ist browserabhängig.',
      'Video is not H.264/AVC. Support depends on the browser.'
    ),
    profile: t(
      'H.264-Profil nicht als Baseline, Main oder High erkannt.',
      'H.264 profile is not recognized as Baseline, Main or High.'
    ),
    level: t(
      'H.264-Level über 4.1: ältere Geräte können Probleme haben.',
      'H.264 level above 4.1: older devices may have problems.'
    ),
    depth: t('Bit-Tiefe ist nicht 8 Bit.', 'Bit depth is not 8-bit.'),
    chroma: t('Farbunterabtastung ist nicht 4:2:0.', 'Chroma subsampling is not 4:2:0.'),
    audio: t('Audio ist nicht AAC/MP3.', 'Audio is not AAC/MP3.'),
    missing: t('Keine Videospur erkannt.', 'No video track detected.'),
    tracks: t('Mehrere Videospuren erkannt.', 'Multiple video tracks detected.')
  };
  return (
    <aside className={`notice ${report.support === 'broad' ? '' : 'warning'}`}>
      <strong>
        {t('Geschätzte Browser-Unterstützung: ', 'Estimated browser support: ')}
        {report.support === 'broad'
          ? t('breit', 'broad')
          : report.support === 'mixed'
            ? t('eingeschränkt / abhängig vom Gerät', 'mixed / device-dependent')
            : report.support === 'limited'
              ? t('gering', 'limited')
              : t('unbekannt', 'unknown')}
      </strong>
      <p>
        {report.container} · {report.video} · {report.profile} · Level {report.level} · {report.audio}
      </p>
      {!!report.issues.length && (
        <>
          <ul>
            {report.issues.map((issue) => (
              <li key={issue}>{problems[issue]}</li>
            ))}
          </ul>
          <p>
            {t(
              'Empfehlung in HandBrake: MP4, Web Optimized, H.264 (x264), 8 Bit / 4:2:0, Main oder High, Level 4.1, maximal 1080p und 30 fps, AAC Stereo. Die Qualität ist abhängig vom Ausgangsmaterial.',
              'Recommended HandBrake settings: MP4, Web Optimized, H.264 (x264), 8-bit / 4:2:0, Main or High, level 4.1, at most 1080p and 30 fps, AAC stereo. Quality depends on the source.'
            )}
          </p>
          <a href="https://handbrake.fr/" target="_blank" rel="noreferrer">
            HandBrake ↗
          </a>
          <br />
        </>
      )}
      <small>
        {t(
          'Einschätzung, keine Garantie. Auch Betriebssystem, Browser und Hardware entscheiden.',
          'Estimate, not a guarantee. OS, browser and hardware also matter.'
        )}
      </small>
    </aside>
  );
};

export { Compatibility };
