import paths from 'path';
import mockFS from 'mock-fs';
import { Logger, setFileTest, setRotationTest, unsetFilTest, unsetRotationTest } from '@/logging/Logger';
import fs from 'fs';
import { deleteDirectory } from '#/util';
import winston from 'winston';

type DailyRotationTransport = winston.transport & { options: Record<string, unknown> };

const path = `${paths.dirname(paths.dirname(__dirname))}/node_modules/`;
let logSpy: jest.Spied<typeof console.log>;
let errorSpy: jest.Spied<typeof console.error>;

jest.mock('@/logging/getSourcePath', () => {
  // noinspection JSUnusedGlobalSymbols
  return {
    getSourcePath(): string {
      return '/path/to/source.js';
    }
  };
});

describe('Logger rotation', (): void => {
  beforeEach(async (): Promise<void> => {
    mockFS({ [path]: mockFS.load(path, { recursive: true }), './logs': {} });
    setFileTest(true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async (): Promise<void> => {
    unsetFilTest();
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    mockFS.restore();
  });

  describe('applies', (): void => {
    test('applies correctly.', (done): void => {
      const logger = new Logger();
      const errorLogger = logger.getErrorLogger();
      errorLogger?.on('finish', () => {
        setTimeout(() => {
          const items = fs.readdirSync('./logs').filter((item) => item.startsWith('error.log'));
          expect(items[0]).toEqual('error.log');
          expect(items[1]).toMatch(/^error\.log\.\d{4}-\d{2}-\d{2}$/);
          errorLogger?.close();
          done();
        }, 300);
      });

      logger.error('test message');
      errorLogger?.end();
    });

    describe('with symlink', (): void => {
      afterEach(async () => {
        await deleteDirectory('./logs');
      });

      test('created', (done): void => {
        mockFS.restore();
        fs.mkdirSync('./logs', { recursive: true });
        fs.readdirSync('./logs')
          .filter((item) => /^.*\.log.*$/u.test(item))
          .forEach((item) => {
            fs.unlinkSync(`./logs/${item}`);
          });
        const logger = new Logger();
        const errorLogger = logger.getErrorLogger();

        errorLogger?.on('finish', () => {
          setTimeout(() => {
            const items = fs.readdirSync('./logs').filter((item) => item.startsWith('error.log'));
            expect(items[0]).toBe('error.log');
            expect(items[1]).toMatch(/^error\.log\.\d{4}-\d{2}-\d{2}$/);
            errorLogger?.close();
            done();
          }, 300);
        });

        logger.error('error message');
        errorLogger?.end();
      });
    });
  });

  describe('rotates', (): void => {
    afterEach(() => {
      unsetRotationTest();
    });

    const doLogs = function (logger: Logger, errorLogger: winston.Logger | null) {
      logger.error('test message 1');
      setTimeout(() => {
        logger.error('test message 2');
        setTimeout(() => {
          logger.error('test message 3');
          setTimeout(() => {
            logger.error('test message 4');
            errorLogger?.end();
          }, 1200);
        }, 1200);
      }, 1200);
    };

    test('rotates daily (mocked to secondly), max 100 (mocked to 3) files, with compression.', (done): void => {
      setRotationTest();
      const logger = new Logger();
      const errorLogger = logger.getErrorLogger();
      errorLogger?.on('finish', () => {
        setTimeout(() => {
          const items = fs.readdirSync('./logs').filter((item) => item.startsWith('error.log'));
          expect(items.length).toBe(4);
          expect(items[1].endsWith('.gz')).toBe(true);
          expect(items[2].endsWith('.gz')).toBe(true);
          expect(fs.readFileSync(`./logs/${items[3]}`, 'utf8')).toContain('test message 4');
          errorLogger?.close();
          done();
        }, 300);
      });

      doLogs(logger, errorLogger);
    });

    test('rotation frequency is daily and max files is 3, errorLogger.', (done): void => {
      unsetRotationTest();

      const logger = new Logger();
      const errorLogger = logger.getErrorLogger();
      errorLogger?.on('finish', () => {
        setTimeout(() => {
          errorLogger?.close();
          done();
        }, 300);
      });

      const transport = errorLogger?.transports?.at(0) as DailyRotationTransport;
      expect(transport?.options?.datePattern).toEqual('YYYY-MM-DD');
      expect(transport?.options?.maxFiles).toBe(100);
      errorLogger?.end();
    });

    test('rotation frequency is daily and max files is 3, accessLogger.', (done): void => {
      unsetRotationTest();

      const logger = new Logger();
      const accessLogger = logger.getAccessLogger();
      accessLogger?.on('finish', () => {
        setTimeout(() => {
          accessLogger?.close();
          done();
        }, 300);
      });

      const transport = accessLogger?.transports?.at(0) as DailyRotationTransport;
      expect(transport?.options?.datePattern).toEqual('YYYY-MM-DD');
      expect(transport?.options?.maxFiles).toBe(100);
      accessLogger?.end();
    });
  });
});
