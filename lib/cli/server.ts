import { isatty } from 'node:tty';

const defaultPort = 3210;

const validPort = (port: unknown, minimum: number) => typeof port === 'number' && Number.isInteger(port) && port >= minimum && port <= 65535;

/**
 * Uses VIDEO_VAULT_PORT when configured; otherwise prompts in an interactive terminal with default 3210.
 * Without an interactive input/output terminal, returns 3210 without prompting.
 * Interactive ports must be 1–65535; environment port 0 permits automatic assignment, as does startServer({ port: 0 }).
 * @throws If the environment value is invalid, the prompt is cancelled or its answer is invalid.
 */
const readServerPort = async function (): Promise<number> {
  if (process.env.VIDEO_VAULT_PORT !== undefined) {
    const port = Number(process.env.VIDEO_VAULT_PORT);
    if (!process.env.VIDEO_VAULT_PORT.trim() || !validPort(port, 0)) throw new RangeError('Invalid VIDEO_VAULT_PORT');
    return port;
  }
  if (!isatty(0) || !isatty(1)) return defaultPort;
  const { default: prompts } = await import('prompts');
  const answers = await prompts(
    {
      type: 'number',
      name: 'port',
      message: 'Server port',
      initial: defaultPort,
      min: 1,
      max: 65535,
      validate: (port: unknown) => validPort(port === '' || port === undefined ? defaultPort : port, 1) || 'Please enter a port between 1 and 65535'
    },
    {
      onCancel: () => {
        throw new Error('Server startup cancelled');
      }
    }
  );
  if (!('port' in answers)) throw new Error('Missing server port answer');
  const port = answers.port === '' || answers.port === undefined ? defaultPort : answers.port;
  if (!validPort(port, 1)) throw new RangeError('Invalid server port');
  return port;
};

export { readServerPort };
