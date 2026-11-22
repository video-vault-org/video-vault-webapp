import { describe, expect, test } from 'vitest';
import { compare, excerpt, filterVideos, sortVideos, formatValue } from '../lib/catalog';
import { emptyCatalog, mergeCatalog, get, put, removePrefix } from '../lib/cache';
import { validateMetadata } from '../components/MetadataFields';
import type { Bootstrap, PlainVideo } from '../lib/types';
import { config, video } from './fixtures';

describe('catalog presentation', () => {
  test('respects ordered direction and uses decrypted title', () => {
    const later = { ...video, videoId: 'later', recorded: '2026-02-01T00:00:00Z' };
    expect(
      sortVideos([{ ...video, videoId: 'z', plainTitle: 'Z' }, later, video], config.meta).map((v) => v.videoId)
    ).toEqual(['later', 'v1', 'z']);
  });

  test('compares arrays lexicographically, not by first value only', () => {
    expect(compare(['a', 'b'], ['a', 'c'])).toBeLessThan(0);
    expect(compare(['a'], ['a', 'b'])).toBeLessThan(0);
    expect(compare([2, 10], [2, 3], 'number')).toBeGreaterThan(0);
  });

  test('sorts configured multiple fields with missing and empty values last in either direction', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const meta = { ...config.meta, sorting: [{ source: 'meta' as const, key: 'people', direction }] };
      expect(
        sortVideos(
          [
            { ...video, videoId: 'empty', meta: { people: [] } },
            { ...video, videoId: 'later', meta: { people: ['Ada', 'Cat'] } },
            video
          ],
          meta
        ).map((v) => v.videoId)
      ).toEqual(direction === 'asc' ? ['v1', 'later', 'empty'] : ['later', 'v1', 'empty']);
    }
  });

  test('combines search words, date range and permitted field filters', () => {
    expect(
      filterVideos([video], 'walk river', { 'meta:people': 'ada', recordedFrom: '2025-01-01' }, config.meta)
    ).toEqual([video]);
    expect(filterVideos([video], 'walk', { 'meta:people': 'cat' }, config.meta)).toEqual([]);
    expect(filterVideos([video], '', { recordedTo: '2025-01-01' }, config.meta)).toEqual([]);
    expect(
      filterVideos(
        [video],
        '',
        { 'meta:people': 'cat' },
        { ...config.meta, fields: config.meta.fields.map((f) => ({ ...f, useAsFilter: false })) }
      )
    ).toEqual([video]);
  });

  test('formats dates, booleans and arrays and truncates by Unicode characters', () => {
    expect(formatValue(true, { type: 'boolean' }, 'de')).toBe('Ja');
    expect(formatValue(['a', 'b'], { type: 'text' }, 'en')).toBe('a, b');
    expect(excerpt('😀'.repeat(151))).toBe('😀'.repeat(150) + '…');
  });

  test('validates required fields and converts free numeric arrays without hardcoded options', () => {
    const field = { ...config.meta.fields[0], type: 'number' as const };
    expect(validateMetadata([field], { people: ['1', '2'] })).toEqual({ people: [1, 2] });
    expect(() => validateMetadata([field], { people: [] })).toThrow();
    expect(() => validateMetadata([field], { people: ['abc'] })).toThrow();
  });
});

describe('offline ciphertext storage', () => {
  test('merges by ID, prunes deleted entries and advances only to newest lastModified', () => {
    const raw = { ...video };
    delete (raw as Partial<PlainVideo>).plainTitle;
    delete (raw as Partial<PlainVideo>).plainDescription;
    const result = mergeCatalog({ videos: [{ ...raw, videoId: 'removed' }], since: '0' }, [raw], ['v1']);
    expect(result).toEqual({ videos: [raw], since: String(Date.parse(video.lastModified)) });
    expect(mergeCatalog(result, [], [])).toEqual({ videos: [], since: result.since });
    expect(emptyCatalog()).toEqual({ videos: [], since: '0' });
  });

  test('persists independently per account and can clear one account only', async () => {
    await put('a:catalog', { ciphertext: true });
    await put('b:catalog', { other: true });
    expect(await get('a:catalog')).toEqual({ ciphertext: true });
    await removePrefix('a:');
    expect(await get('a:catalog')).toBeUndefined();
    expect(await get('b:catalog')).toEqual({ other: true });
  });
});

test('date metadata rejects rolled-over calendar dates and date-time values are normalized', () => {
  const field = { ...config.meta.fields[0], type: 'date' as const, multiple: false };
  expect(() => validateMetadata([field], { people: '2026-02-30' })).toThrow();
  expect(validateMetadata([field], { people: '2026-02-28' })).toEqual({ people: '2026-02-28' });
  expect(validateMetadata([{ ...field, type: 'datetime' }], { people: '2026-01-01T12:00:00+02:00' })).toEqual({
    people: '2026-01-01T10:00:00.000Z'
  });
});

test('filters numbers and equivalent instants by type and namespaces metadata keys separately from recorded filters', () => {
  const fields = [
    { ...config.meta.fields[0], key: 'recordedFrom', type: 'number' as const, multiple: false },
    { ...config.meta.fields[0], key: 'at', type: 'datetime' as const, multiple: false }
  ];
  const item = { ...video, meta: { recordedFrom: 2, at: '2026-01-01T10:00:00.000Z' } };
  expect(
    filterVideos(
      [item],
      '',
      { 'meta:recordedFrom': '2.0', 'meta:at': '2026-01-01T12:00:00+02:00' },
      { ...config.meta, fields }
    )
  ).toEqual([item]);
});
