import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Comments } from '../components/Comments';
import { VideoOverlay } from '../components/VideoOverlay';
import { LanguageProvider } from '../lib/ui';
import { json } from '../lib/api';
import { decryptText } from '../lib/crypto';
import { config, video } from './fixtures';
import type { Keys, User } from '../lib/types';

vi.mock('../lib/api', () => ({ json: vi.fn() }));

vi.mock('../lib/crypto', () => ({
  decryptText: vi.fn(),
  verify: vi.fn(),
  encryptText: vi.fn(),
  sign: vi.fn()
}));

vi.mock('../lib/mediaBridge', () => ({
  mediaUrl: vi.fn().mockResolvedValue({ url: '/__media/test', dispose: vi.fn() })
}));

// noinspection HtmlRequiredAltAttribute, HtmlUnknownTarget
const attack = '<img src=x onerror="globalThis.compromised=true"><script>alert(1)</script>';

test('decrypted comments and server-added display names remain text', async () => {
  vi.mocked(json).mockResolvedValue({
    comments: [
      {
        commentId: 'c1',
        videoId: 'v1',
        userId: 'u1',
        displayName: attack,
        content: 'encrypted',
        deleted: false,
        edited: false,
        created: '2026-01-01T00:00:00Z'
      }
    ],
    cursor: ''
  });
  vi.mocked(decryptText).mockResolvedValue(attack);
  const { container } = render(
    <LanguageProvider>
      <Comments videoId="v1" keys={{} as Keys} user={{ userId: 'other' } as User} close={vi.fn()} />
    </LanguageProvider>
  );
  await screen.findByText(attack, { selector: 'p' });
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
});

test('decrypted video titles, descriptions, metadata labels and values remain text', async () => {
  const settings = {
    ...config,
    meta: { ...config.meta, fields: [{ ...config.meta.fields[0], name: { de: attack, en: attack } }] }
  };
  const { container } = render(
    <LanguageProvider>
      <VideoOverlay
        video={{ ...video, plainTitle: attack, plainDescription: attack, meta: { people: [attack] } }}
        config={settings}
        keys={{} as Keys}
        user={{} as User}
        close={vi.fn()}
        edit={vi.fn()}
        removed={vi.fn()}
      />
    </LanguageProvider>
  );
  expect(screen.getByRole('heading', { name: attack })).toBeVisible();
  await screen.findByRole('link', { name: 'Herunterladen' });
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('dt')).toHaveTextContent(attack);
  expect(container.querySelector('dd')).toHaveTextContent(attack);
});
