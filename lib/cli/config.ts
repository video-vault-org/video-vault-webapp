import { access, mkdir } from 'node:fs/promises';
import prompts from 'prompts';
import { z } from 'zod';
import { loadConfig as loadDatabaseConfig, saveConfig as saveDatabaseConfig } from '@/db';
import { DatabaseConfig } from '@/db/config/DatabaseConfig';
import { loadConfig as loadStorageConfig, saveConfig as saveStorageConfig } from '@/storage';
import { StorageConfig } from '@/storage/config/StorageConfig';

const text = z.string().trim().min(1, 'Please enter a value');
const secret = z.string().min(1, 'Please enter a value');
const optionalText = z.string().optional();
const endpoint = z.url({ protocol: /^https?$/ }).optional();
const port = z.coerce.number().int().min(1).max(65535);

/** Asks a single question, applies its default on empty input and validates the resulting value. */
async function ask<T>(question: prompts.PromptObject, schema: z.ZodType<T>): Promise<T> {
  const normalize = (value: unknown) => (value === '' || value === undefined ? question.initial : value);
  const answers = await prompts(
    { ...question, name: 'value', validate: (value: unknown) => schema.safeParse(normalize(value)).success || 'Please enter a valid value' },
    {
      onCancel: () => {
        throw new Error('Configuration initialization cancelled');
      }
    }
  );
  // A missing answer also covers incomplete/cancelled responses returned by the prompt implementation.
  if (!('value' in answers)) throw new Error('Missing configuration answer');
  return schema.parse(normalize(answers.value));
}

async function askText(message: string, initial?: string, password = false): Promise<string> {
  return await ask({ type: password ? 'password' : 'text', name: 'value', message, initial }, password ? secret : text);
}

async function askOptional(message: string, initial?: string, password = false, url = false): Promise<string | undefined> {
  return await ask({ type: password ? 'password' : 'text', name: 'value', message: `${message} (optional)`, initial }, url ? endpoint : optionalText);
}

/** Prompts for the database adapter before asking only for its supported settings. */
async function readDatabaseConfig(existing?: DatabaseConfig | null): Promise<DatabaseConfig> {
  const type = await ask(
    {
      type: 'select',
      name: 'value',
      message: 'Database adapter',
      initial: ['sqlite', 'postgresql', 'mongo', 'dynamodb', 'in-memory'].indexOf(existing?.type ?? 'sqlite'),
      choices: [
        { title: 'SQLite', value: 'sqlite' },
        { title: 'PostgreSQL', value: 'postgresql' },
        { title: 'MongoDB', value: 'mongo' },
        { title: 'DynamoDB', value: 'dynamodb' },
        { title: 'In-memory (not persistent)', value: 'in-memory' }
      ]
    },
    z.enum(['sqlite', 'postgresql', 'mongo', 'dynamodb', 'in-memory'])
  );
  if (type === 'in-memory') return { type };
  if (type === 'sqlite') {
    return { type, conf: { filePath: await askText('SQLite file path', existing?.type === type ? existing.conf.filePath : './video-vault.db') } };
  }
  if (type === 'postgresql') {
    const conf = existing?.type === type ? existing.conf : {};
    return {
      type,
      conf: {
        host: await askText('PostgreSQL host', conf.host ?? 'localhost'),
        port: await ask({ type: 'text', name: 'value', message: 'PostgreSQL port', initial: String(conf.port ?? 5432) }, port),
        database: await askText('PostgreSQL database', conf.database ?? 'video-vault-db'),
        user: await askText('PostgreSQL username', conf.user ?? 'postgres'),
        password: await askOptional('PostgreSQL password', conf.password, true)
      }
    };
  }
  if (type === 'mongo') {
    const conf = existing?.type === type ? existing.conf : undefined;
    return {
      type,
      conf: {
        url: await askText('MongoDB URL', conf?.url ?? 'mongodb://localhost:27017/video-vault-db'),
        user: await askOptional('MongoDB username', conf?.user),
        pass: await askOptional('MongoDB password', conf?.pass, true)
      }
    };
  }
  const conf = existing?.type === type ? existing.conf : {};
  const config: DatabaseConfig = {
    type,
    conf: {
      region: await askText('DynamoDB region', conf.region ?? 'eu-central-1'),
      endpoint: await askOptional('DynamoDB endpoint', conf.endpoint, false, true),
      tablePrefix: await askText('DynamoDB table prefix', conf.tablePrefix ?? 'video-vault-'),
      accessKeyId: await askOptional('DynamoDB access key ID (leave empty to use the AWS credential chain)', conf.accessKeyId),
      secretAccessKey: await askOptional('DynamoDB secret access key', conf.secretAccessKey, true),
      sessionToken: await askOptional('DynamoDB session token', conf.sessionToken, true)
    }
  };
  if (!!config.conf.accessKeyId !== !!config.conf.secretAccessKey || (config.conf.sessionToken && !config.conf.accessKeyId)) {
    throw new Error('DynamoDB credentials require both access key ID and secret access key');
  }
  return config;
}

/** Prompts for the storage adapter before asking only for its supported settings. */
async function readStorageConfig(existing?: StorageConfig | null): Promise<StorageConfig> {
  const type = await ask(
    {
      type: 'select',
      name: 'value',
      message: 'Storage adapter',
      initial: ['local', 's3', 'in-memory'].indexOf(existing?.type ?? 'local'),
      choices: [
        { title: 'Local filesystem', value: 'local' },
        { title: 'S3 / S3-compatible', value: 's3' },
        { title: 'In-memory (not persistent)', value: 'in-memory' }
      ]
    },
    z.enum(['local', 's3', 'in-memory'])
  );
  if (type === 'in-memory') return { type };
  if (type === 'local') {
    return { type, conf: { basePath: await askText('Local storage base path', existing?.type === type ? existing.conf.basePath : './storage') } };
  }
  const conf = existing?.type === type ? existing.conf : undefined;
  return {
    type,
    conf: {
      region: await askText('S3 region', conf?.region ?? 'eu-central-1'),
      accessKeyId: await askText('S3 access key ID', conf?.accessKeyId),
      secretAccessKey: await askText('S3 secret access key', conf?.secretAccessKey, true),
      bucket: await askText('S3 bucket', conf?.bucket ?? 'video-vault'),
      endpoint: await askOptional('S3 endpoint', conf?.endpoint, false, true),
      forcePathStyle: await ask({ type: 'toggle', name: 'value', message: 'S3 force path style', initial: conf?.forcePathStyle ?? false, active: 'Yes', inactive: 'No' }, z.boolean())
    }
  };
}

async function configExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Configures the database, then storage, using existing values or defaults for empty answers.
 * Collects both configurations before writing ./conf/db.json and ./conf/storage.json through their saveConfig functions.
 * Requests confirmation before replacing existing files. Creates ./conf on first use. No database or storage connection is opened.
 * @throws If input is cancelled or invalid, an existing config cannot be loaded, or saving fails.
 */
async function initializeConfig(): Promise<void> {
  const database = await readDatabaseConfig(await loadDatabaseConfig());
  const storage = await readStorageConfig(await loadStorageConfig());
  const existingFiles = await Promise.all(['./conf/db.json', './conf/storage.json'].map(configExists));
  if (existingFiles.some(Boolean)) {
    const confirmed = await ask({ type: 'confirm', name: 'value', message: 'Replace existing configuration files?', initial: false }, z.boolean());
    if (!confirmed) throw new Error('Configuration replacement declined');
  }
  await mkdir('./conf', { recursive: true });
  await saveDatabaseConfig(database);
  await saveStorageConfig(storage);
}

export { initializeConfig };
