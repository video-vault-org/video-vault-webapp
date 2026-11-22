import prompts from 'prompts';
import { isatty } from 'node:tty';
import { readServerPort } from '@/cli/server';

jest.mock('prompts', () => jest.fn());

jest.mock('node:tty', () => ({ isatty: jest.fn() }));

describe('server port selection', () => {
  const originalPort = process.env.VIDEO_VAULT_PORT;
  const originalLegacyPort = process.env.PORT;

  beforeEach(() => {
    delete process.env.VIDEO_VAULT_PORT;
    delete process.env.PORT;
    jest.mocked(isatty).mockReset().mockReturnValue(true);
    jest.mocked(prompts).mockReset().mockResolvedValue({ port: 3210 });
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env.VIDEO_VAULT_PORT;
    else process.env.VIDEO_VAULT_PORT = originalPort;
    if (originalLegacyPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalLegacyPort;
  });

  test.each([3210, 4000, 1, 65535])('prompts for an interactive port with default 3210 and returns %s', async (port) => {
    jest.mocked(prompts).mockResolvedValueOnce({ port });
    await expect(readServerPort()).resolves.toBe(port);
    expect(prompts).toHaveBeenCalledWith(expect.objectContaining({ type: 'number', message: 'Server port', initial: 3210, min: 1, max: 65535 }), expect.anything());
  });

  test.each(['', undefined])('uses the default when the answer is empty (%j)', async (port) => {
    jest.mocked(prompts).mockResolvedValueOnce({ port });
    await expect(readServerPort()).resolves.toBe(3210);
    const question = jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject;
    expect(await question.validate!(port, {}, question)).toBe(true);
  });

  test.each([0, -1, 65536, 1.5, NaN, null])('rejects an invalid interactive port (%s)', async (port) => {
    jest.mocked(prompts).mockResolvedValueOnce({ port });
    await expect(readServerPort()).rejects.toThrow(RangeError);
    const question = jest.mocked(prompts).mock.calls[0][0] as prompts.PromptObject;
    expect(await question.validate!(port, {}, question)).toBe('Please enter a port between 1 and 65535');
    expect(await question.validate!(3210, {}, question)).toBe(true);
  });

  test.each(['0', '1', '4000', '65535'])('uses VIDEO_VAULT_PORT=%s without prompting', async (port) => {
    process.env.VIDEO_VAULT_PORT = port;
    await expect(readServerPort()).resolves.toBe(Number(port));
    expect(prompts).not.toHaveBeenCalled();
  });

  test.each(['', ' ', '-1', '65536', '1.5', 'invalid'])('rejects an invalid VIDEO_VAULT_PORT=%j without prompting', async (port) => {
    process.env.VIDEO_VAULT_PORT = port;
    await expect(readServerPort()).rejects.toThrow('Invalid VIDEO_VAULT_PORT');
    expect(prompts).not.toHaveBeenCalled();
  });

  test.each(['stdin', 'stdout'] as const)('defaults to 3210 when %s is not a terminal', async (stream) => {
    jest.mocked(isatty).mockImplementation((fd) => fd !== (stream === 'stdin' ? 0 : 1));
    await expect(readServerPort()).resolves.toBe(3210);
    expect(prompts).not.toHaveBeenCalled();
  });

  test('ignores the old PORT variable', async () => {
    process.env.PORT = '4000';
    await expect(readServerPort()).resolves.toBe(3210);
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  test('cancellation prevents startup', async () => {
    jest.mocked(prompts).mockImplementationOnce(async (question, options) => {
      options?.onCancel?.(question as prompts.PromptObject, {});
      return {};
    });
    await expect(readServerPort()).rejects.toThrow('Server startup cancelled');
  });

  test('does not treat missing answers as accepting the default', async () => {
    jest.mocked(prompts).mockResolvedValueOnce({});
    await expect(readServerPort()).rejects.toThrow('Missing server port answer');
  });

  test('propagates terminal errors', async () => {
    const error = new Error('Terminal unavailable');
    jest.mocked(prompts).mockRejectedValueOnce(error);
    await expect(readServerPort()).rejects.toBe(error);
  });
});
