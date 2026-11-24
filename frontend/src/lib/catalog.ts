import type { Bootstrap, PlainVideo, MetaField, Language } from './types';

/** Arrays compare lexicographically, element by element in stored order. Empty/missing values are last in either direction. */
const compare = function (a: unknown, b: unknown, type: MetaField['type'] = 'text'): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const n = compare(a[i], b[i], type);
      if (n) return n;
    }
    return a.length - b.length;
  }
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'boolean') return Number(a) - Number(b);
  if (type === 'date' || type === 'datetime') return Date.parse(String(a)) - Date.parse(String(b));
  const x = String(a).normalize('NFC').toLocaleLowerCase('und'),
    y = String(b).normalize('NFC').toLocaleLowerCase('und');
  return x < y ? -1 : x > y ? 1 : 0;
};

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

const sortVideos = function (videos: PlainVideo[], meta: Bootstrap['meta']): PlainVideo[] {
  return [...videos].sort((a, b) => {
    for (const s of meta.sorting) {
      const x = s.source === 'title' ? a.plainTitle : s.source === 'recorded' ? a.recorded : a.meta[s.key],
        y = s.source === 'title' ? b.plainTitle : s.source === 'recorded' ? b.recorded : b.meta[s.key];
      if (empty(x) || empty(y)) {
        if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
        continue;
      }
      const type =
        s.source === 'recorded'
          ? 'datetime'
          : s.source === 'meta'
            ? meta.fields.find((f) => f.key === s.key)?.type
            : 'text';
      const result = compare(x, y, type);
      if (result) return result * (s.direction === 'desc' ? -1 : 1);
    }
    return a.videoId.localeCompare(b.videoId);
  });
};

const filterVideos = function (
  videos: PlainVideo[],
  query: string,
  filters: Record<string, string>,
  meta: Bootstrap['meta']
): PlainVideo[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return videos.filter((v) => {
    const search = [v.plainTitle, v.plainDescription, ...Object.values(v.meta).map(String)]
      .join(' ')
      .toLocaleLowerCase();
    if (!words.every((w) => search.includes(w))) return false;
    const timestamp = new Date(v.recorded);
    const recordedDay = meta.recorded.withTime
      ? new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      : v.recorded.slice(0, 10);
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      if (key === 'recordedFrom' && meta.recorded.useAsFilter && recordedDay < value) return false;
      if (key === 'recordedTo' && meta.recorded.useAsFilter && recordedDay > value) return false;
      const field = meta.fields.find((f) => `meta:${f.key}` === key && f.useAsFilter);
      if (field) {
        const data = Array.isArray(v.meta[field.key]) ? (v.meta[field.key] as unknown[]) : [v.meta[field.key]];
        if (
          !data.some(
            (x) =>
              x !== undefined &&
              x !== null &&
              (field.options
                ? x === value
                : field.type === 'text'
                  ? String(x ?? '')
                      .toLocaleLowerCase()
                      .includes(value.toLocaleLowerCase())
                  : field.type === 'boolean'
                    ? String(x) === value
                    : compare(x, value, field.type) === 0)
          )
        )
          return false;
      }
    }
    return true;
  });
};

const formatValue = function (value: unknown, field: Pick<MetaField, 'type'>, language: Language): string {
  if (Array.isArray(value)) return value.map((v) => formatValue(v, field, language)).join(', ');
  if (value === undefined || value === null) return '—';
  if (field.type === 'boolean') return value ? (language === 'de' ? 'Ja' : 'Yes') : language === 'de' ? 'Nein' : 'No';
  if (field.type === 'date' || field.type === 'datetime') {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime())
      ? '—'
      : new Intl.DateTimeFormat(language, {
          dateStyle: 'medium',
          ...(field.type === 'datetime' ? { timeStyle: 'short' } : { timeZone: 'UTC' })
        }).format(d);
  }
  return String(value);
};

const excerpt = (value: string) =>
  Array.from(value).length > 150 ? Array.from(value).slice(0, 150).join('') + '…' : value;

export { compare, sortVideos, filterVideos, formatValue, excerpt };
