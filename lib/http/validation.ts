import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().min(1).max(4096);
const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const password = z.object({ loginHash: text, passwordKeySalt: text, userKey: text }).strict();
const video = z.object({ videoId: id, title: text, meta: z.record(z.string(), z.unknown()), videoMimeType: text, thumbnailMimeType: text, lastModified: date, hmac: text }).strict();
const commentChange = z.object({ content: z.string().max(1_000_000), lastModified: date, hmac: text }).strict();
const videoChange = z.object({ lastModified: date, hmac: text });

/** Parses an ISO date with timezone or a non-negative Unix timestamp in milliseconds. */
function sinceDate(value: unknown): Date {
  const input = z.string().min(1).parse(value);
  if (/^\d+$/.test(input)) {
    return z.date().parse(new Date(Number(input)));
  }
  return date.parse(input);
}

export { id, text, date, password, video, commentChange, videoChange, sinceDate };
