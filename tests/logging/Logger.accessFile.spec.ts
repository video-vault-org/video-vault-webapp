import paths from 'path';
import fs from 'fs';
import mockFS from 'mock-fs';
import { setFileTest, unsetFilTest } from '@/logging/Logger';
import { Logger } from '@/logging/Logger';
import process from 'process';

const path = `${paths.dirname(paths.dirname(__dirname))}/node_modules/`;
const accessLogFile = paths.join('./logs', 'access.log');
let logSpy: jest.Spied<typeof console.log>;

const ip = '127.0.0.1';
const method = 'GET';
const uri = '/image.png';
const httpVersion = 'HTTP/2.0';
const statusCode = 200;
const contentLength = '815';
const referer = 'http://i.am.from/here';
const userAgent = 'testUserAgent';
const time = 23;

let lastLoggedMessage = '';

describe('Access Logger', (): void => {
  beforeEach(async (): Promise<void> => {
    mockFS({ [path]: mockFS.load(path, { recursive: true }), './logs': {} });
    setFileTest(false);
    logSpy = jest.spyOn(console, 'log').mockImplementation((message) => (lastLoggedMessage = message));
    process.stdout.isTTY = true;
    process.stderr.isTTY = true;
  });

  afterEach(async (): Promise<void> => {
    mockFS.restore();
    unsetFilTest();
    logSpy?.mockRestore();
    lastLoggedMessage = '';
  });

  test('logs access correctly, without error.', (done): void => {
    const logger = new Logger();
    const accessLogger = logger.getAccessLogger();
    accessLogger?.on('finish', () => {
      setTimeout(() => {
        const message = fs.readFileSync(accessLogFile, 'utf8');
        const { timestamp, ...rest } = JSON.parse(message.trim());
        expect(rest).toEqual({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time });
        expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u);
        expect(lastLoggedMessage).toContain('INFO: Access: GET /image.png - 200 - 815');
        done();
      }, 300);
    });

    logger.access({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time });
    accessLogger?.end();
  });

  test('logs access correctly, without undefined error.', (done): void => {
    const logger = new Logger();
    const accessLogger = logger.getAccessLogger();
    accessLogger?.on('finish', () => {
      setTimeout(() => {
        const message = fs.readFileSync(accessLogFile, 'utf8');
        const { timestamp, ...rest } = JSON.parse(message.trim());
        expect(rest).toEqual({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time, error: undefined });
        expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u);
        done();
      }, 300);
    });

    logger.access({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time });
    accessLogger?.end();
  });

  test('logs access correctly, with error.', (done): void => {
    const logger = new Logger();
    const accessLogger = logger.getAccessLogger();
    accessLogger?.on('finish', () => {
      setTimeout(() => {
        const message = fs.readFileSync(accessLogFile, 'utf8');
        const { timestamp, ...rest } = JSON.parse(message.trim());
        expect(rest).toEqual({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time, error: 'test error' });
        expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u);
        done();
      }, 300);
    });

    logger.access({ ip, method, path: uri, httpVersion, statusCode, contentLength, referer, userAgent, time, error: 'test error' });
    accessLogger?.end();
  });
});
