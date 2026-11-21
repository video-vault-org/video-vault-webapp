import { dynamoTablePrefix } from '@/app/dynamoTablePrefix';

describe('DynamoDB prefix derived from the application title', () => {
  test.each([
    ['VideoVault', 'video-vault-'],
    ['Meine Videos', 'meine-videos-'],
    ['  Familien-Filme  ', 'familien-filme-'],
    ['Grüße & Videos!', 'grusse-videos-'],
    ['Video 2026', 'video-2026-']
  ])('normalizes %s into %s', (title, expected) => {
    expect(dynamoTablePrefix(title)).toBe(expected);
  });

  test('uses deterministic, distinct hashes for titles without ASCII letters or digits', () => {
    const prefix = dynamoTablePrefix('家庭');
    expect(prefix).toMatch(/^app-[a-f0-9]{16}-$/);
    expect(dynamoTablePrefix('家庭')).toBe(prefix);
    expect(dynamoTablePrefix('映画')).not.toBe(prefix);
  });

  test('keeps unusually long normalized names within DynamoDB limits with a hash suffix', () => {
    const prefix = dynamoTablePrefix('ﬃ'.repeat(100));
    expect(prefix).toMatch(/^[a-z0-9-]+-[a-f0-9]{16}-$/);
    expect((prefix + 'login-attempts').length).toBeLessThanOrEqual(255);
    expect(dynamoTablePrefix('ﬃ'.repeat(99) + 'a')).not.toBe(prefix);
  });

  test.each(['', ' ', 'a'.repeat(101)])('rejects invalid titles (%j)', (title) => {
    expect(() => dynamoTablePrefix(title)).toThrow();
  });
});
