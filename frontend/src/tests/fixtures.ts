import type { Bootstrap, PlainVideo } from '../lib/types';
const config: Bootstrap = {
  version: 1,
  instanceSalt: 'ab'.repeat(32),
  app: { title: 'My videos' },
  meta: {
    recorded: { withTime: false, useAsFilter: true },
    fields: [
      {
        key: 'people',
        name: 'People',
        type: 'text',
        multiple: true,
        required: true,
        showInDetails: true,
        useAsFilter: true
      }
    ],
    sorting: [
      { source: 'recorded', direction: 'desc' },
      { source: 'title', direction: 'asc' }
    ]
  }
};
const video: PlainVideo = {
  videoId: 'v1',
  title: 'ciphertext',
  description: 'cipher-description',
  plainTitle: 'A walk',
  plainDescription: 'By the river',
  meta: { people: ['Ada', 'Bob'] },
  videoMimeType: 'video/mp4',
  thumbnailMimeType: 'image/png',
  recorded: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-01-02T00:00:00.000Z',
  hmac: 'hmac'
};

export { config, video };
