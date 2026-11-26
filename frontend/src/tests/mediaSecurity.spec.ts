import { expect, test } from 'vitest';
import { mediaHeaders } from '../lib/mediaSecurity';

test.each([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'video/mp4\r\nX-Test: bad'
])('does not interpret decrypted media as executable content: %s', (mime) => {
  const headers = mediaHeaders(mime);
  expect(headers['Content-Type']).toBe('application/octet-stream');
  expect(headers['X-Content-Type-Options']).toBe('nosniff');
  expect(headers['Content-Security-Policy']).toContain("script-src 'none'");
  expect(headers['Content-Security-Policy']).toContain("form-action 'none'");
});

test.each(['video/mp4', 'video/webm; codecs="vp9"', 'audio/ogg'])(
  'preserves supported media content types: %s',
  (mime) => {
    expect(mediaHeaders(mime)['Content-Type']).toBe(mime);
  }
);
