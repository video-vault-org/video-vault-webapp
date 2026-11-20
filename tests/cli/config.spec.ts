import { access, mkdir } from 'node:fs/promises';
import prompts from 'prompts';
import { initializeConfig } from '@/cli/config';
import { loadConfig as loadDatabaseConfig, saveConfig as saveDatabaseConfig } from '@/db';
import { loadConfig as loadStorageConfig, saveConfig as saveStorageConfig } from '@/storage';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';
import { StorageConfig } from '@/storage/config/StorageConfig';

jest.mock('prompts', () => jest.fn());
jest.mock('node:fs/promises', () => ({ access: jest.fn(), mkdir: jest.fn() }));
jest.mock('@/db', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));
jest.mock('@/storage', () => ({ loadConfig: jest.fn(), saveConfig: jest.fn() }));

let answers: unknown[];
let questions: prompts.PromptObject[];

function reply(...values: unknown[]) {
  answers = values;
}

describe('configuration initialization', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    answers = [];
    questions = [];
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

  test('asks for the database before storage and saves default paths through saveConfig', async () => {
    reply(undefined, '', undefined, '');
    await initializeConfig();
    expect(questions.map((q) => q.message)).toEqual(['Database adapter', 'SQLite file path', 'Storage adapter', 'Local storage base path']);
    expect(saveDatabaseConfig).toHaveBeenCalledWith({ type: 'sqlite', conf: { filePath: './video-vault.db' } });
    expect(saveStorageConfig).toHaveBeenCalledWith({ type: 'local', conf: { basePath: './storage' } });
    expect(mkdir).toHaveBeenCalledWith('./conf', { recursive: true });
    expect(jest.mocked(saveDatabaseConfig).mock.invocationCallOrder[0]).toBeGreaterThan(jest.mocked(prompts).mock.invocationCallOrder[3]);
    expect(jest.mocked(saveStorageConfig).mock.invocationCallOrder[0]).toBeGreaterThan(jest.mocked(saveDatabaseConfig).mock.invocationCallOrder[0]);
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
    { answers: ['s3', '', 'id', 'secret', '', '', false], expected: { type: 's3', conf: { region: 'eu-central-1', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'video-vault', endpoint: undefined, forcePathStyle: false } } },
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

  test('masks passwords, secret keys and session tokens', async () => {
    reply('dynamodb', '', '', '', 'id', 'secret', 'token', 's3', '', 'id', 'secret', '', '', false);
    await initializeConfig();
    expect(questions.filter((q) => q.type === 'password').map((q) => q.message)).toEqual(['DynamoDB secret access key (optional)', 'DynamoDB session token (optional)', 'S3 secret access key']);
  });

  test('prefills existing settings and confirms replacement with a safe default', async () => {
    const database: DatabaseConfig = { type: 'postgresql', conf: { host: 'existing', port: 6543, database: 'vault', user: 'bob', password: ' secret ' } };
    const storage: StorageConfig = { type: 's3', conf: { region: 'region', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'bucket', endpoint: 'https://s3.example.org', forcePathStyle: true } };
    jest.mocked(loadDatabaseConfig).mockResolvedValue(database);
    jest.mocked(loadStorageConfig).mockResolvedValue(storage);
    jest.mocked(access).mockResolvedValue(undefined);
    reply(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
    await initializeConfig();
    expect(saveDatabaseConfig).toHaveBeenCalledWith(database);
    expect(saveStorageConfig).toHaveBeenCalledWith(storage);
    expect(questions.at(-1)).toMatchObject({ type: 'confirm', initial: false });
  });

  test.each([false, undefined])('does not save when replacement is declined (%s)', async (confirmation) => {
    jest.mocked(access).mockResolvedValue(undefined);
    reply('in-memory', 'in-memory', confirmation);
    await expect(initializeConfig()).rejects.toThrow('replacement declined');
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  test('confirms even if only the database file exists but loadConfig returns null', async () => {
    jest.mocked(access).mockResolvedValueOnce(undefined);
    reply('in-memory', 'in-memory', true);
    await initializeConfig();
    expect(questions.at(-1)?.type).toBe('confirm');
    expect(saveDatabaseConfig).toHaveBeenCalled();
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

  test.each([1, 2])('cancelling prompt %i prevents both writes', async (step) => {
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
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
    expect(saveStorageConfig).not.toHaveBeenCalled();
  });

  test('rejects missing answers instead of silently using a default', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({});
    await expect(initializeConfig()).rejects.toThrow('Missing configuration answer');
    expect(saveDatabaseConfig).not.toHaveBeenCalled();
  });

  test.each(['loadDatabase', 'loadStorage', 'prompt', 'access', 'directory', 'saveDatabase', 'saveStorage'])('propagates %s failures', async (step) => {
    const error = new Error('Failure');
    reply('in-memory', 'in-memory');
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
