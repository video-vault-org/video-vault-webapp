import { expect, test } from 'vitest';
import { assess } from '../lib/compatibility';
const tracks = [
  { '@type': 'General', Format: 'MPEG-4' },
  {
    '@type': 'Video',
    Format: 'AVC',
    Format_Profile: 'High',
    Format_Level: '4.1',
    BitDepth: 8,
    ChromaSubsampling: '4:2:0'
  },
  { '@type': 'Audio', Format: 'AAC' }
];

test('recognizes a conservative broadly supported MP4/AVC/AAC combination', () => {
  expect(assess(tracks)).toMatchObject({ support: 'broad', issues: [], mime: 'video/mp4' });
});

test('identifies profile, level, bit depth, chroma and audio risks individually', () => {
  const result = assess([
    tracks[0],
    { ...tracks[1], Format_Profile: 'High 10', Format_Level: '5.2', BitDepth: 10, ChromaSubsampling: '4:4:4' },
    { '@type': 'Audio', Format: 'DTS' }
  ]);
  expect(result.support).toBe('mixed');
  expect(result.issues).toEqual(expect.arrayContaining(['profile', 'level', 'depth', 'chroma', 'audio']));
});

test('does not claim universal HEVC/WebM support or accept missing video tracks', () => {
  expect(assess([tracks[0], { ...tracks[1], Format: 'HEVC' }]).support).toBe('mixed');
  expect(
    assess([
      { '@type': 'General', Format: 'Matroska' },
      { ...tracks[1], Format: 'FFV1' }
    ]).support
  ).toBe('limited');
  expect(assess([tracks[0]]).support).toBe('unknown');
});
