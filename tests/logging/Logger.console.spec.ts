import { Logger, setConsoleTest, unsetConsoleTest } from '@/logging/Logger';
import process from 'process';

let logSpy: jest.Spied<typeof console.log>;
let errorSpy: jest.Spied<typeof console.error>;
let loggedMessage = '';

describe('Logger logs to console', (): void => {
  beforeEach(async (): Promise<void> => {
    setConsoleTest();
    logSpy = jest.spyOn(console, 'log').mockImplementation((message) => {
      loggedMessage = message;
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation((message) => {
      loggedMessage = message;
    });
    process.stdout.isTTY = true;
    process.stderr.isTTY = true;
    jest.useFakeTimers();
    jest.setSystemTime(42 + new Date().getTimezoneOffset() * 60 * 1000);
  });

  afterEach(async (): Promise<void> => {
    unsetConsoleTest();
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    loggedMessage = '';
    jest.useRealTimers();
  });

  const assertMessage = function (loggedMessage: string, level: string): void {
    const colorSequenceNumbers: Record<string, number> = {
      info: 32,
      warn: 33,
      error: 31
    };
    expect(loggedMessage.split(' ')[0]).toBe(`\x1B[${colorSequenceNumbers[level]}m1970-01-01T00:00:00.042`);
    expect(loggedMessage.split(' ')[1]).toMatch(/^\[.*[\/\\]Logger\.console\.spec\.ts\]/u);
    expect(loggedMessage.split(' ')[2]).toMatch(`${level.toUpperCase()}:`);
    expect(loggedMessage.split(' ')[3]).toBe('test');
    expect(loggedMessage.split(' ')[4].trim()).toBe('message\x1B[39m');
  };

  test('on level info', async (): Promise<void> => {
    new Logger().info('test message');

    expect(logSpy).toHaveBeenCalled();
    assertMessage(loggedMessage, 'info');
  });

  test('on level warn', async (): Promise<void> => {
    new Logger().warn('test message');

    expect(logSpy).toHaveBeenCalled();
    assertMessage(loggedMessage, 'warn');
  });

  test('on level error', async (): Promise<void> => {
    new Logger().error('test message');

    expect(errorSpy).toHaveBeenCalled();
    assertMessage(loggedMessage, 'error');
  });
});
