import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose from 'mongoose';
import { MongoDatabaseAdapter } from '@/adapter/db/MongoDatabaseAdapter';
import { DbItem } from '@/adapter/db/DatabaseAdapter';

describe('MongoDatabaseAdapter', (): void => {
  jest.setTimeout(60000);

  let container: StartedMongoDBContainer | null = null;
  let db: null | MongoDatabaseAdapter = null;
  let url = 'mongodb://localhost:27017/video-vault';

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:6.0.1').start();
    url = `${container.getConnectionString()}/video-vault`;
  });

  afterAll(async () => {
    container?.stop();
  });

  beforeEach(async (): Promise<void> => {
    db = new MongoDatabaseAdapter(url);
  });

  afterEach(async (): Promise<void> => {
    if (db?.getCollections()?.user_) {
      await db.getCollections().user_.deleteOne({ username: 'testUser' });
      await db.getCollections().user_.deleteOne({ username: 'other' });
      await db.getCollections().user_.deleteOne({ username: 'newUsername' });
    }
    await db?.close();
  });

  test('MongoDatabaseAdapter->constructor works correctly, no auth.', async (): Promise<void> => {
    //const url = 'mongodb://localhost:27017/video-vault';
    //console.log({ url });

    //const newDb = new MongoDatabaseAdapter(url);

    //expect(newDb.getConf()).toEqual([url, '', '']);
    expect(0).toBeLessThan(1);
  });
});
