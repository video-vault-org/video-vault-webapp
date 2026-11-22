import { createHash } from 'node:crypto';
import { appConfigSchema } from './config/AppConfig';

/**
 * Derives a DynamoDB-safe prefix from the current title, including camel-case word boundaries.
 * Diacritics are removed and other separators become hyphens. Titles without ASCII letters/digits
 * use a hash instead; unusually long normalized titles retain a hash suffix to avoid truncation collisions.
 * VideoVault yields video-vault-, preserving the original default table names.
 */
const dynamoTablePrefix = function (title: string): string {
  const validated = appConfigSchema.parse({ title }).title;
  // noinspection SpellCheckingInspection
  const slug = validated
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug && slug.length <= 100) return `${slug}-`;
  const hash = createHash('sha256').update(validated, 'utf8').digest('hex').slice(0, 16);
  return `${slug.slice(0, 100).replace(/-+$/, '') || 'app'}-${hash}-`;
};

export { dynamoTablePrefix };
