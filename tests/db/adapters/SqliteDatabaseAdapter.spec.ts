import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabaseAdapter } from '@/db/adapters/SqliteDatabaseAdapter';
import { tables } from '@/db/tables';
import { DbItem } from '@/db/types/DbItem';
import { DbTableDefinition } from '@/db/types/DbTableDefinition';

const definition: DbTableDefinition = {
  table: 'test_items',
  key: 'id',
  fields: { id: 'string', group: 'string', score: 'number', active: 'boolean', created: 'Date', lastModified: 'Date' }
};

const { table } = definition;
const first = { id: 'a', group: 'selected', score: 42, active: true, created: new Date(10) };
const second = { id: 'b', group: 'selected', score: 23, active: false, created: new Date(30) };
const other = { id: 'c', group: 'other', score: 17, active: false, created: new Date(40) };

describe('SqliteDatabaseAdapter', () => {
  let db: SqliteDatabaseAdapter;

  beforeEach(() => {
    db = new SqliteDatabaseAdapter({ filePath: ':memory:' });
  });

  afterEach(async () => {
    await db.close();
  });

  test('open makes the database available', async () => {
    await expect(db.init(definition)).rejects.toThrow('SQLite database is not open');

    await db.open();
    await db.init(definition);

    expect(await db.findAll(table)).toEqual([]);
  });

  test('close releases the in-memory database', async () => {
    await db.open();
    await db.init(definition);
    await db.add(table, first);

    await db.close();
    await expect(db.init(definition)).rejects.toThrow('SQLite database is not open');

    await db.open();
    await db.init(definition);
    expect(await db.findAll(table)).toEqual([]);
  });

  describe('queries', () => {
    beforeEach(async () => {
      await db.open();
      await db.init(definition);
    });

    const addItems = async (items: DbItem[]): Promise<void> => {
      for (const item of items) {
        await db.add(table, item);
      }
    };

    test('init preserves existing rows when called again', async () => {
      await db.add(table, first);

      await db.init(definition);

      expect(await db.findAll(table)).toEqual([first]);
    });

    test('add stores an item', async () => {
      await db.add(table, first);

      expect(await db.findAll(table)).toEqual([first]);
    });

    test('update changes one matching item', async () => {
      await addItems([first, second]);

      expect(await db.update(table, 'id', first.id, { score: 50, active: false })).toBe(1);
      expect(await db.findOne(table, 'id', first.id)).toEqual({ ...first, score: 50, active: false });
      expect(await db.findOne(table, 'id', second.id)).toEqual(second);
    });

    test('update can change the primary key', async () => {
      await db.add(table, first);

      expect(await db.update(table, 'id', first.id, { id: 'new' })).toBe(1);
      expect(await db.findOne(table, 'id', first.id)).toBeNull();
      expect(await db.findOne(table, 'id', 'new')).toEqual({ ...first, id: 'new' });
    });

    test('update changes every matching item', async () => {
      await addItems([first, second, other]);

      expect(await db.update(table, 'group', first.group, { score: 99 })).toBe(2);
      expect(await db.findMany(table, 'group', first.group, {})).toEqual([
        { ...second, score: 99 },
        { ...first, score: 99 }
      ]);
      expect(await db.findOne(table, 'id', other.id)).toEqual(other);
    });

    test('update returns zero when nothing matches', async () => {
      await db.add(table, first);

      expect(await db.update(table, 'id', 'missing', { score: 99 })).toBe(0);
      expect(await db.findAll(table)).toEqual([first]);
    });

    test('exists checks whether an item matches', async () => {
      await db.add(table, first);

      expect(await db.exists(table, 'active', true)).toBe(true);
      expect(await db.exists(table, 'active', false)).toBe(false);
    });

    test('delete removes a single matching item', async () => {
      await addItems([first, second]);

      expect(await db.delete(table, 'id', first.id)).toBe(1);
      expect(await db.findAll(table)).toEqual([second]);
    });

    test('delete removes every matching item', async () => {
      await addItems([first, second, other]);

      expect(await db.delete(table, 'group', first.group)).toBe(2);
      expect(await db.findAll(table)).toEqual([other]);
    });

    test('delete returns zero when nothing matches', async () => {
      await db.add(table, first);

      expect(await db.delete(table, 'id', 'missing')).toBe(0);
      expect(await db.findAll(table)).toEqual([first]);
    });

    test('findOne returns an item or null', async () => {
      await db.add(table, first);

      expect(await db.findOne(table, 'id', first.id)).toEqual(first);
      expect(await db.findOne(table, 'id', 'missing')).toBeNull();
    });

    test('findMany filters, sorts by creation date and applies pagination', async () => {
      const tied = { ...second, id: 'd' };
      await addItems([tied, other, first, second]);

      expect(await db.findMany(table, 'group', first.group, {})).toEqual([second, tied, first]);
      expect(await db.findMany(table, 'group', first.group, { skip: 1, get: 1 })).toEqual([tied]);
      expect(await db.findMany(table, 'group', first.group, { skip: 2 })).toEqual([first]);
      expect(await db.findMany(table, 'group', first.group, { get: 0 })).toEqual([]);
      expect(await db.findMany(table, 'group', 'missing', {})).toEqual([]);
    });

    test('findAll returns every row without guaranteeing an order', async () => {
      await addItems([first, second, other]);

      const items = await db.findAll(table);

      expect(items).toHaveLength(3);
      expect(items).toEqual(expect.arrayContaining([first, second, other]));
    });

    test('findAllSince includes the boundary and skips older or undated rows', async () => {
      const atBoundary = { ...second, lastModified: new Date(20) };
      const newer = { ...other, lastModified: new Date(30) };
      await addItems([{ ...first, lastModified: new Date(10) }, atBoundary, newer, { ...first, id: 'undated' }]);

      const items = await db.findAllSince(table, new Date(20));

      expect(items).toHaveLength(2);
      expect(items).toEqual(expect.arrayContaining([atBoundary, newer]));
    });

    test('findAllSince returns an empty list for a table without lastModified', async () => {
      await db.init({ table: 'keys', key: 'id', fields: { id: 'string' } });
      await db.add('keys', { id: 'key1' });

      expect(await db.findAllSince('keys', new Date(0))).toEqual([]);
    });
  });

  describe('SQLite storage', () => {
    let directory: string;
    let filePath: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'video-vault-sqlite-'));
      filePath = join(directory, 'test.sqlite');
      db = new SqliteDatabaseAdapter({ filePath });
      await db.open();
    });

    afterEach(async () => {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    });

    test('preserves stored data and primary key constraints across connections', async () => {
      await db.init(definition);
      await db.add(table, first);
      await db.close();

      db = new SqliteDatabaseAdapter({ filePath });
      await db.open();
      await db.init(definition);

      expect(await db.findOne(table, 'id', first.id)).toEqual(first);
      await expect(db.add(table, first)).rejects.toThrow(/UNIQUE constraint failed/);
      expect(await db.findAll(table)).toEqual([first]);
    });

    test('round-trips JSON, dates and booleans and omits unset columns', async () => {
      for (const definition of tables) {
        await db.init(definition);
      }
      const video = { videoId: 'v1', title: "A video's title", meta: { tracks: ['video', 'audio'] }, lastModified: new Date(25) };
      const user = { userId: 'u1', admin: false, videoManager: true };
      await db.add('video', video);
      await db.add('user_', user);

      expect(await db.findOne('video', 'title', video.title)).toEqual(video);
      expect(await db.findOne('user_', 'admin', false)).toEqual(user);
    });

    test('creates indexes for comment ordering and lastModified queries', async () => {
      for (const definition of tables) {
        await db.init(definition);
      }
      const { DatabaseSync } = await import('node:sqlite');
      const inspection = new DatabaseSync(filePath);
      try {
        const commentIndex = inspection.prepare("PRAGMA index_xinfo('comment_by_video_created')").all();
        expect(commentIndex).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ seqno: 0, name: 'videoId', desc: 0, key: 1 }),
            expect.objectContaining({ seqno: 1, name: 'created', desc: 1, key: 1 }),
            expect.objectContaining({ seqno: 2, name: 'commentId', desc: 0, key: 1 })
          ])
        );
        for (const table of ['comment', 'video']) {
          const lastModifiedIndex = inspection.prepare(`PRAGMA index_info('idx_${table}_last_modified')`).all();
          expect(lastModifiedIndex).toEqual([expect.objectContaining({ name: 'lastModified' })]);
        }
      } finally {
        inspection.close();
      }
    });
  });
});
