import paths from 'path';
import fs from 'fs';
import mockFS from 'mock-fs';
import { setFileTest, unsetFilTest } from '@/logging/Logger';
import { Logger } from '@/logging/Logger';

const path = `${paths.dirname(paths.dirname(__dirname))}/node_modules/`;
const errorLogFile = paths.join('./logs', 'error.log');
let logSpy: jest.Spied<typeof console.log>;
let errorSpy: jest.Spied<typeof console.error>;

describe('Logger logs to error file', (): void => {
  beforeEach(async (): Promise<void> => {
    mockFS({ [path]: mockFS.load(path, { recursive: true }), './logs': {} });
    setFileTest(false);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async (): Promise<void> => {
    unsetFilTest();
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    mockFS.restore();
  });

  test('logs error correctly.', (done): void => {
    const logger = new Logger();
    const errorLogger = logger.getErrorLogger();
    errorLogger?.on('finish', () => {
      setTimeout(() => {
        const message = fs.readFileSync(errorLogFile, 'utf8');
        expect(message.trim()).toMatch(
          /^\{"timestamp":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}","level":"error","source":".*[\/\\]Logger\.errorFile\.spec\.ts","message":"test message"\}$/u
        );
        done();
      }, 300);
    });

    logger.error('test message');
    errorLogger?.end();
  });
});
