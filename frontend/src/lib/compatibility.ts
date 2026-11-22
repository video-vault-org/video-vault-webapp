import mediaInfoFactory from 'mediainfo.js';
import wasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url';

interface MediaReport {
  support: 'broad' | 'mixed' | 'limited' | 'unknown';
  container: string;
  video: string;
  audio: string;
  profile: string;
  level: string;
  issues: string[];
  mime: string;
}

const assess = function (tracks: Record<string, unknown>[]): MediaReport {
  const general = tracks.find((t) => t['@type'] === 'General') ?? {},
    videos = tracks.filter((t) => t['@type'] === 'Video'),
    audios = tracks.filter((t) => t['@type'] === 'Audio'),
    v = videos[0] ?? {};
  const container = String(general.Format ?? '?'),
    video = String(v.Format ?? '?'),
    audio = audios.map((a) => String(a.Format ?? '?')).join(', ') || '—',
    profile = String(v.Format_Profile ?? '?'),
    level = String(v.Format_Level ?? '?'),
    issues: string[] = [];
  const mov = /QuickTime/i.test(container + ' ' + String(general.Format_Profile ?? '')),
    mp4 = /MPEG-4/i.test(container) && !mov,
    avc = video === 'AVC',
    webm = /WebM/i.test(container);
  if (!mp4 && !webm) issues.push('container');
  if (!avc) issues.push('codec');
  if (avc && !/^(Baseline|Constrained Baseline|Main|High)(?:@|$)/i.test(profile)) issues.push('profile');
  if (avc && !Number.isFinite(Number.parseFloat(level.replace(/[^\d.]/g, '')))) issues.push('level-unknown');
  if (avc && Number.parseFloat(level.replace(/[^\d.]/g, '')) > 4.1) issues.push('level');
  if (v.BitDepth !== undefined && Number(v.BitDepth) !== 8) issues.push('depth');
  if (v.ChromaSubsampling !== undefined && !String(v.ChromaSubsampling).startsWith('4:2:0')) issues.push('chroma');
  if (audios.some((a) => !['AAC', 'MPEG Audio'].includes(String(a.Format)))) issues.push('audio');
  if (!videos.length) issues.push('missing');
  if (videos.length > 1) issues.push('tracks');
  const broad = mp4 && avc && !issues.length;
  return {
    support: !videos.length
      ? 'unknown'
      : broad
        ? 'broad'
        : avc || webm || /AV1|VP9|HEVC/.test(video)
          ? 'mixed'
          : 'limited',
    container,
    video,
    audio,
    profile,
    level,
    issues,
    mime: mov
      ? 'video/quicktime'
      : mp4
        ? 'video/mp4'
        : webm
          ? 'video/webm'
          : /Matroska/i.test(container)
            ? 'video/x-matroska'
            : /AVI/i.test(container)
              ? 'video/x-msvideo'
              : ''
  };
};

const inspect = async function (file: File): Promise<MediaReport> {
  const analyzer = await mediaInfoFactory({ locateFile: () => wasmUrl });
  try {
    const result = await analyzer.analyzeData(
      file.size,
      async (size, offset) => new Uint8Array(await file.slice(offset, offset + size).arrayBuffer())
    );
    return assess((result.media?.track ?? []) as unknown as Record<string, unknown>[]);
  } finally {
    analyzer.close();
  }
};

export { MediaReport, assess, inspect };
