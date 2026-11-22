import { Type, TProperties, Static } from 'typebox';
import { HttpError } from './errors';

/** Strict JSON objects reject unexpected input fields instead of silently removing them. */
const object = <T extends TProperties>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });
const text = Type.String({ minLength: 1, maxLength: 4096 });
const username = Type.String({ minLength: 3, maxLength: 4096 });
const date = Type.String({ format: 'date-time' });
const metadata = Type.Record(Type.String(), Type.Unknown());
const passwordProperties = { loginHash: text, passwordKeySalt: text, userKey: text };
const password = object(passwordProperties);
const videoProperties = { videoId: id, title: text, description: Type.String({ minLength: 1, maxLength: 1_000_000 }), meta: metadata, videoMimeType: text, thumbnailMimeType: text, recorded: date, lastModified: date, hmac: text };
const video = object(videoProperties);
const comment = object({ commentId: id, userId: id, videoId: id, content: Type.String({ maxLength: 1_000_000 }), created: date, lastModified: date, edited: Type.Boolean(), deleted: Type.Boolean(), hmac: text });
const user = object({ userId: id, username, displayName: text, passwordKeySalt: text, userKey: text, admin: Type.Boolean(), editor: Type.Boolean(), moderator: Type.Boolean() });
const commentChange = object({ content: Type.String({ maxLength: 1_000_000 }), lastModified: date, hmac: text });
const videoChange = { lastModified: date, hmac: text };
const error = object({ error: Type.String() });
const errorResponses = { '4xx': error, '5xx': error };
const noContent = { 204: Type.Null(), ...errorResponses };

/** Converts validated wire timestamps to the Date values expected by database services. */
function videoInput(input: Static<typeof video>) {
  return { ...input, recorded: new Date(input.recorded), lastModified: new Date(input.lastModified) };
}

/** Parses an ISO date with timezone or a non-negative Unix timestamp in milliseconds. */
function sinceDate(value: string): Date {
  const parsed = new Date(/^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, 'Invalid date');
  return parsed;
}

export { Type, object, id, text, username, date, metadata, passwordProperties, password, video, videoChange, comment, commentChange, user, errorResponses, noContent, videoInput, sinceDate };
