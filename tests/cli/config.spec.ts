import { access, mkdir } from 'node:fs/promises';
import prompts from 'prompts';
import { initializeConfig } from '@/cli/config';
import { loadConfig as loadDatabaseConfig, saveConfig as saveDatabaseConfig } from '@/db';
import { loadConfig as loadStorageConfig, saveConfig as saveStorageConfig } from '@/storage';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';
import { StorageConfig } from '@/storage/config/StorageConfig';
import { loadConfig as loadAppConfig, saveConfig as saveAppConfig } from '@/app';

jest.mock('prompts', () => jest.fn());

jest.mock('node:fs/promises', () => ({ access: jest.fn(), mkdir: jest.fn() }));

jest.mock('@/app', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

jest.mock('@/db', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

jest.mock('@/storage', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

let answers: unknown[];
let questions: prompts.PromptObject[];

const reply = function (...values: unknown[]) {
  answers = [undefined, ...values];
};

describe('configuration initialization', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    answers = [];
    questions = [];
    jest.mocked(loadAppConfig).mockResolvedValue(null);
    jest.mocked(saveAppConfig).mockResolvedValue(undefined);
    jest.mocked(loadDatabaseConfig).mockResolvedValue(null);
    jest.mocked(loadStorageConfig).mockResolvedValue(null);
    jest.mocked(access).mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' }));
    jest.mocked(mkdir).mockResolvedValue(undefined);
    jest.mocked(saveDatabaseConfig).mockResolvedValue(undefined);
    jest.mocked(saveStorageConfig).mockResolvedValue(undefined);

    jest.mocked(prompts).mockImplementation(async (question) => {
      const q = question as prompts.PromptObject;
      questions.push(q);
      if (!answers.length) throw new Error('Unexpected question');
      const value = answers.shift();
      if (value === undefined) {
        if (q.type === 'select') return { value: (q.choices as prompts.Choice[])[q.initial as number].value };
        return { value: q.initial ?? '' };
      }
      return { value };
    });
  });

  test('asks for application, database and storage settings and saves their defaults', async () => {
    reply(undefined, '', undefined, '');
    await initializeConfig();
    expect(questions.map((q) => q.message)).toEqual(['Application title (default for the DynamoDB table prefix)', 'Database adapter', 'SQLite file path', 'Storage adapter', 'Local storage base path']);
    expect(saveAppConfig).toHaveBeenCalledWith({ title: 'VideoVault' });
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'sqlite', conf: { filePath: './video-vault.db' } });
    expect(saveStorageConfig).toHaveBeenCalledWith({ type: 'local', conf: { basePath: './storage' } });
    expect(mkdir).toHaveBeenCalledWith('./conf', { recursive: true });
    expect(jest.mocked(saveDatabaseConfig).mock.invocationCallOrder[0]).toBeGreaterThan(jest.mocked(prompts).mock.invocationCallOrder[4]);
    expect(jest.mocked(saveStorageConfig).mock.invocationCallOrder[0]).toBeGreaterThan(jest.mocked(saveDatabaseConfig).mock.invocationCallOrder[0]);
  });

  test.each([
    { title: 'Meine Videos', path: '', expected: './video-vault.db' },
    { title: 'Grüße/Videos', path: '', expected: './video-vault.db' },
    { title: 'Meine Videos', path: '/data/custom.sqlite', expected: '/data/custom.sqlite' }
  ])('uses the fixed SQLite default regardless of the title and allows a custom path ($title, $path)', async ({ title, path, expected }) => {
    jest.mocked(loadAppConfig).mockResolvedValue({ title: 'Previous title' });
    answers = [title, 'sqlite', path, 'in-memory'];
    await initializeConfig();
    expect(saveAppConfig).toHaveBeenCalledWith({ title });
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'sqlite', conf: { filePath: expected } });
    expect(answers).toHaveLength(0);
  });

  test('preserves an existing SQLite path as the default when the title changes', async () => {
    jest.mocked(loadDatabaseConfig).mockResolvedValue({ type: 'sqlite', conf: { filePath: '/data/existing.sqlite' } });
    jest.mocked(access).mockResolvedValue(undefined);
    answers = ['New title', true, 'sqlite', '', true, 'in-memory', true];
    await initializeConfig();
    expect(questions.find((question) => question.message === 'SQLite file path')?.initial).toBe('/data/existing.sqlite');
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'sqlite', conf: { filePath: '/data/existing.sqlite' } });
    expect(answers).toHaveLength(0);
  });

  test.each<{ answers: unknown[]; expected: DatabaseConfig }>([
    { answers: ['in-memory'], expected: { type: 'in-memory' } },
    { answers: ['sqlite', '/data/database.sqlite'], expected: { type: 'sqlite', conf: { filePath: '/data/database.sqlite' } } },
    { answers: ['postgresql', '', '', '', '', ''], expected: { type: 'postgresql', conf: { host: 'localhost', port: 5432, database: 'video-vault-db', user: 'postgres', password: undefined } } },
    { answers: ['postgresql', 'db.internal', '6543', 'vault', 'alice', ' pass '], expected: { type: 'postgresql', conf: { host: 'db.internal', port: 6543, database: 'vault', user: 'alice', password: ' pass ' } } },
    { answers: ['mongo', '', '', ''], expected: { type: 'mongo', conf: { url: 'mongodb://localhost:27017/video-vault-db', user: undefined, pass: undefined } } },
    { answers: ['mongo', 'mongodb://host/db', 'alice', 'secret'], expected: { type: 'mongo', conf: { url: 'mongodb://host/db', user: 'alice', pass: 'secret' } } },
    { answers: ['dynamodb', '', '', '', '', '', ''], expected: { type: 'dynamodb', conf: { region: 'eu-central-1', endpoint: undefined, tablePrefix: 'video-vault-', accessKeyId: undefined, secretAccessKey: undefined, sessionToken: undefined } } },
    {
      answers: ['dynamodb', 'us-east-1', 'http://localhost:8000', 'custom-', 'id', 'secret', 'token'],
      expected: { type: 'dynamodb', conf: { region: 'us-east-1', endpoint: 'http://localhost:8000', tablePrefix: 'custom-', accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 'token' } }
    }
  ])('collects only the settings for database $expected.type', async ({ answers: inputs, expected }) => {
    reply(...inputs, 'in-memory');
    await initializeConfig();
    expect(saveDatabaseConfig).toHaveBeenCalledWith(expected);
    expect(saveStorageConfig).toHaveBeenCalledWith({ type: 'in-memory' });
    expect(answers).toHaveLength(0);
  });

  test.each<{ answers: unknown[]; expected: StorageConfig }>([
    { answers: ['in-memory'], expected: { type: 'in-memory' } },
    { answers: ['local', '/data/storage'], expected: { type: 'local', conf: { basePath: '/data/storage' } } },
    { answers: ['s3', '', 'id', 'secret', '', '', false], expected: { type: 's3', conf: { region: 'eu-central-1', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'VideoVault', endpoint: undefined, forcePathStyle: false } } },
    {
      answers: ['s3', 'us-east-1', 'custom-id', ' secret ', 'bucket', 'http://localhost:9000', true],
      expected: { type: 's3', conf: { region: 'us-east-1', accessKeyId: 'custom-id', secretAccessKey: ' secret ', bucket: 'bucket', endpoint: 'http://localhost:9000', forcePathStyle: true } }
    }
  ])('collects only the settings for storage $expected.type', async ({ answers: inputs, expected }) => {
    reply('in-memory', ...inputs);
    await initializeConfig();
    expect(saveStorageConfig).toHaveBeenCalledWith(expected);
    expect(answers).toHaveLength(0);
  });

  test.each([
    { title: 'my-video-archive', bucket: '', expected: 'my-video-archive' },
    { title: 'my-video-archive', bucket: 'custom-bucket', expected: 'custom-bucket' }
  ])('uses the current application title as the S3 bucket default and allows overrides ($bucket)', async ({ title, bucket, expected }) => {
    answers = [title, 'in-memory', 's3', '', 'id', 'secret', bucket, '', false];
    await initializeConfig();
    expect(questions.find((question) => question.message === 'S3 bucket')?.initial).toBe(title);
    expect(saveStorageConfig).toHaveBeenCalledWith({ type: 's3', conf: { region: 'eu-central-1', accessKeyId: 'id', secretAccessKey: 'secret', bucket: expected, endpoint: undefined, forcePathStyle: false } });
    expect(answers).toHaveLength(0);
  });

  test('masks passwords, secret keys and session tokens', async () => {
    reply('dynamodb', '', '', '', 'id', 'secret', 'token', 's3', '', 'id', 'secret', '', '', false);
    await initializeConfig();
    expect(questions.filter((q) => q.type === 'password').map((q) => q.message)).toEqual(['DynamoDB secret access key (optional)', 'DynamoDB session token (optional)', 'S3 secret access key']);
  });

  test('prefills existing settings and confirms replacement with a safe default', async () => {
    const database: DatabaseConfig = { type: 'postgresql', conf: { host: 'existing', port: 6543, database: 'vault', user: 'bob', password: ' secret ' } };
    const storage: StorageConfig = { type: 's3', conf: { region: 'region', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'bucket', endpoint: 'https://s3.example.org', forcePathStyle: true } };
    jest.mocked(loadAppConfig).mockResolvedValue({ title: 'Existing title' });
    jest.mocked(loadDatabaseConfig).mockResolvedValue(database);
    jest.mocked(loadStorageConfig).mockResolvedValue(storage);
    jest.mocked(access).mockResolvedValue(undefined);
    reply(true, ...Array(6).fill(undefined), true, ...Array(7).fill(undefined), true);
    await initializeConfig();
    expect(saveAppConfig).toHaveBeenCalledWith({ title: 'Existing title' });
    expect(saveDatabaseConfig).toHaveBeenCalledWith(database);
    expect(saveStorageConfig).toHaveBeenCalledWith(storage);
    expect(questions.at(-1)).toMatchObject({ type: 'confirm', initial: false });
    const messages = questions.map((question) => question.message);
    expect(messages.indexOf('Database configuration already exists. Reconfigure?')).toBeLessThan(messages.indexOf('Database adapter'));
    expect(messages.indexOf('Storage configuration already exists. Reconfigure?')).toBeLessThan(messages.indexOf('Storage adapter'));
  });

  test.each([
    { databaseExists: true, storageExists: false, replies: [false, 'in-memory'] },
    { databaseExists: false, storageExists: true, replies: ['in-memory', false] },
    { databaseExists: true, storageExists: true, replies: [false, false] },
    { databaseExists: true, storageExists: true, replies: [undefined, undefined] }
  ])('skips existing configurations independently without loading or saving them ($databaseExists, $storageExists, $replies)', async ({ databaseExists, storageExists, replies }) => {
    jest.mocked(access).mockImplementation(async (path) => {
      if ((path === './conf/db.json' && databaseExists) || (path === './conf/storage.json' && storageExists)) return;
      throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    });

    reply(...replies);
    await initializeConfig();
    expect(saveAppConfig).toHaveBeenCalledWith({ title: 'VideoVault' });
    for (const [exists, load, save, adapterQuestion] of [
      [databaseExists, loadDatabaseConfig, saveDatabaseConfig, 'Database adapter'],
      [storageExists, loadStorageConfig, saveStorageConfig, 'Storage adapter']
    ] as const) {
      if (exists) {
        expect(load).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(questions.some((question) => question.message === adapterQuestion)).toBe(false);
      } else {
        expect(load).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith({ type: 'in-memory' });
      }
    }
    expect(questions.some((question) => question.message === 'Replace existing configuration files?')).toBe(false);
    expect(answers).toHaveLength(0);
  });

  test.each(['Database', 'Storage'])('cancelling the %s reconfiguration question prevents all writes', async (target) => {
    jest.mocked(access).mockImplementation(async (path) => {
      if (path === (target === 'Database' ? './conf/db.json' : './conf/storage.json')) return;
      throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    });

    const implementation = jest.mocked(prompts).getMockImplementation()!;

    jest.mocked(prompts).mockImplementation(async (question, options) => {
      if ((question as prompts.PromptObject).message === `${target} configuration already exists. Reconfigure?`) {
        options?.onCancel?.(question as prompts.PromptObject, {});
        return {};
      }
      return implementation(question, options);
    });

    reply('in-memory');
    await expect(initializeConfig()).rejects.toThrow('cancelled');
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test.each([false, undefined])('does not save when replacement is declined (%s)', async (confirmation) => {
    jest.mocked(access).mockResolvedValue(undefined);
    reply(true, 'in-memory', true, 'in-memory', confirmation);
    await expect(initializeConfig()).rejects.toThrow('replacement declined');
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  test('confirms even if only the database file exists but loadConfig returns null', async () => {
    jest.mocked(access).mockImplementation(async (path) => {
      if (path !== './conf/db.json') throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    });

    reply(true, 'in-memory', 'in-memory', true);
    await initializeConfig();
    expect(questions.at(-1)?.type).toBe('confirm');
    expect(saveDatabaseConfig).toHaveBeenCalled();
  });

  test('uses the custom title as the default DynamoDB table prefix', async () => {
    answers = ['Meine Videos', 'dynamodb', '', '', '', '', '', '', 'in-memory'];
    await initializeConfig();
    expect(saveAppConfig).toHaveBeenCalledWith({ title: 'Meine Videos' });
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'dynamodb', conf: { region: 'eu-central-1', tablePrefix: 'meine-videos-' } });
    expect(questions.find((question) => question.message === 'DynamoDB table prefix')?.initial).toBe('meine-videos-');
    expect(answers).toHaveLength(0);
  });

  test('prefills and preserves an existing DynamoDB prefix independently of the application title', async () => {
    jest.mocked(loadAppConfig).mockResolvedValue({ title: 'A new title' });
    jest.mocked(loadDatabaseConfig).mockResolvedValue({ type: 'dynamodb', conf: { region: 'eu-central-1', tablePrefix: 'existing-prefix-' } });
    jest.mocked(access).mockResolvedValue(undefined);
    reply(true, ...Array(7).fill(undefined), true, 'in-memory', true);
    await initializeConfig();
    expect(questions.find((question) => question.message === 'DynamoDB table prefix')?.initial).toBe('existing-prefix-');
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'dynamodb', conf: { region: 'eu-central-1', tablePrefix: 'existing-prefix-' } });
    expect(answers).toHaveLength(0);
  });

  test.each(['has spaces', 'invalid/prefix', 'a'.repeat(242)])('rejects invalid DynamoDB table prefixes before saving (%j)', async (prefix) => {
    reply('dynamodb', '', '', prefix);
    await expect(initializeConfig()).rejects.toThrow();
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test('confirms replacement when only the application configuration file exists', async () => {
    jest.mocked(access).mockImplementation(async (path) => {
      if (path !== './conf/app.json') throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    });

    reply('in-memory', 'in-memory', false);
    await expect(initializeConfig()).rejects.toThrow('replacement declined');
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test.each([' ', 'a'.repeat(101)])('rejects an invalid application title before saving configurations (%j)', async (title) => {
    answers = [title, 'in-memory', 'in-memory'];
    await expect(initializeConfig()).rejects.toThrow();
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test.each([
    ['postgresql', '', '0'],
    ['postgresql', '', '65536'],
    ['postgresql', '', '1.5'],
    ['postgresql', '', 'abc'],
    ['sqlite', '   '],
    ['unknown'],
    ['dynamodb', '', 'file:///tmp/db'],
    ['dynamodb', '', '', '', 'id', '', ''],
    ['dynamodb', '', '', '', '', 'secret', ''],
    ['dynamodb', '', '', '', '', '', 'token'],
    ['in-memory', 's3', '', '', 'secret'],
    ['in-memory', 's3', '', 'id', '', '', '', false]
  ])('does not save invalid answers %j', async (...inputs) => {
    reply(...inputs);
    await expect(initializeConfig()).rejects.toThrow();
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test('exposes validators that reject invalid input and accept defaults', async () => {
    reply('postgresql', '', '', '', '', '', 'in-memory');
    await initializeConfig();
    const q = questions.find((q) => q.message === 'PostgreSQL port')!;
    expect(await q.validate!('', {}, q)).toBe(true);
    expect(await q.validate!('70000', {}, q)).toBe('Please enter a valid value');
  });

  test.each([1, 2, 3])('cancelling prompt %i prevents all configuration writes', async (step) => {
    reply('in-memory', 'in-memory');
    const implementation = jest.mocked(prompts).getMockImplementation()!;

    jest.mocked(prompts).mockImplementation(async (question, options) => {
      if (questions.length === step - 1) {
        options?.onCancel?.(question as prompts.PromptObject, {});
        return {};
      }
      return await implementation(question, options);
    });

    await expect(initializeConfig()).rejects.toThrow('cancelled');
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test('rejects missing answers instead of silently using a default', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({});
    await expect(initializeConfig()).rejects.toThrow('Missing configuration answer');
    expect(saveAppConfig).not.toHaveBeenCalled();
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
  });

  test.each(['loadApp', 'loadDatabase', 'loadStorage', 'prompt', 'access', 'directory', 'saveApp', 'saveDatabase', 'saveStorage'])('propagates %s failures', async (step) => {
    const error = new Error('Failure');
    reply('in-memory', 'in-memory');
    if (step === 'loadApp') jest.mocked(loadAppConfig).mockRejectedValueOnce(error);
    if (step === 'saveApp') jest.mocked(saveAppConfig).mockRejectedValueOnce(error);
    if (step === 'loadDatabase') jest.mocked(loadDatabaseConfig).mockRejectedValueOnce(error);
    if (step === 'loadStorage') jest.mocked(loadStorageConfig).mockRejectedValueOnce(error);
    if (step === 'prompt') jest.mocked(prompts).mockRejectedValueOnce(error);
    if (step === 'access') jest.mocked(access).mockRejectedValueOnce(error);
    if (step === 'directory') jest.mocked(mkdir).mockRejectedValueOnce(error);
    if (step === 'saveDatabase') jest.mocked(saveDatabaseConfig).mockRejectedValueOnce(error);
    if (step === 'saveStorage') jest.mocked(saveStorageConfig).mockRejectedValueOnce(error);
    await expect(initializeConfig()).rejects.toBe(error);
    if (step !== 'saveStorage') expect(saveStorageConfig).not.toHaveBeenCalled();
  });
});
