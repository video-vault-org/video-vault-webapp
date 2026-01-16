import { createLogger, format, transports, Logger as WinstonLogger, LogEntry } from 'winston';
import paths from 'path';
import process from 'process';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AccessLogEntry } from '@/logging/types/AccessLogEntry';
import { getSourcePath } from '@/logging/getSourcePath';

const { combine, timestamp, printf, colorize } = format;

let forceConsole = false;
let fileLogging = true;
let rotation = true;
let rotationDatePattern: string = 'YYYY-MM-DD';
let rotationMaxFiles: number = 100;

const formatNumber = function (value: number, digits: number): string {
  return (value + '').padStart(digits, '0');
};

const dateFormatter = function (): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = formatNumber(date.getMonth() + 1, 2);
  const day = formatNumber(date.getDate(), 2);
  const hour = formatNumber(date.getHours(), 2);
  const minute = formatNumber(date.getMinutes(), 2);
  const second = formatNumber(date.getSeconds(), 2);
  const milli = formatNumber(date.getMilliseconds(), 3);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milli}`;
};

const buildMetaPad = function (meta: unknown, delimiter: ' - ' | '\n'): string {
  return meta ? `${delimiter}${JSON.stringify(meta)}` : '';
};

const logFormats = {
  coloredHumanReadableLine({ level, message, timestamp, sourcePath, meta }: LogEntry): string {
    const metaPad = buildMetaPad(meta, ' - ');
    const prefix = message.startsWith('Access:') ? timestamp : `${timestamp} [${sourcePath}] ${level.toUpperCase()}:`;
    return colorize().colorize(level, `${prefix} ${message}${metaPad}`);
  },
  json({ level, message, timestamp, sourcePath, meta }: LogEntry): string {
    const messageString = message as string;
    const messageProperty = messageString.includes('\n') ? messageString.split('\n') : messageString;
    const logObject = { timestamp, level, source: sourcePath, message: messageProperty, meta };
    return JSON.stringify(logObject);
  },
  access({ error, ...rest }: AccessLogEntry): string {
    if (error) {
      return JSON.stringify({ error, ...rest });
    }
    return JSON.stringify({ ...rest });
  }
};

/**
 * Used to log access, errors and other events.
 * It logs all events except for access to tty.
 * It also logs errors to log file and webserver access to access log file.
 * TTY logging and file logging use different formats.
 * When stdout or stderr is redirected to file, file logging format is used.
 */
class Logger {
  private ttyLogger: WinstonLogger | null = null;
  private errorFileLogger: WinstonLogger | null = null;
  private accessFileLogger: WinstonLogger | null = null;

  private createRotationTransportOptions(path: string) {
    return {
      datePattern: rotationDatePattern,
      zippedArchive: true,
      maxFiles: rotationMaxFiles,
      createSymlink: true,
      filename: `${path}.%DATE%`,
      symlinkName: paths.basename(path),
      auditFile: paths.join(paths.dirname(path), `.${paths.basename(path)}-audit.json`)
    };
  }

  private createConsoleLogger() {
    const stdoutIsTTY = process.stdout.isTTY ?? false;
    const stderrIsTTY = process.stderr.isTTY ?? false;
    this.ttyLogger = createLogger({
      level: 'info',
      format: combine(
        timestamp({ format: dateFormatter }),
        printf(({ level, message, timestamp, sourcePath, meta }) => {
          const outLoggingFormat = stdoutIsTTY ? 'coloredHumanReadableLine' : 'json';
          const errLoggingFormat = stderrIsTTY ? 'coloredHumanReadableLine' : 'json';
          const loggingFormat = level === 'error' ? errLoggingFormat : outLoggingFormat;
          return logFormats[loggingFormat]({ level, message: message as string, timestamp, sourcePath, meta });
        })
      ),
      transports: [new transports.Console({ forceConsole, stderrLevels: ['error'] })]
    });
  }

  private createErrorFileLogger() {
    if (!fileLogging) {
      return;
    }
    const path = './logs/error.log';
    const transport = rotation ? new DailyRotateFile(this.createRotationTransportOptions(path)) : new transports.File({ filename: path });
    this.errorFileLogger = createLogger({
      exitOnError: false,
      level: 'error',
      format: combine(
        timestamp({ format: dateFormatter }),
        printf(({ level, message, timestamp, sourcePath, meta }) => {
          return logFormats.json({ level, message: message as string, timestamp, sourcePath, meta });
        })
      ),
      transports: [transport]
    });
  }

  private createAccessFileLogger() {
    if (!fileLogging) {
      return;
    }
    const path = './logs/access.log';
    const transport = rotation ? new DailyRotateFile(this.createRotationTransportOptions(path)) : new transports.File({ filename: path });
    this.accessFileLogger = createLogger({
      exitOnError: false,
      level: 'info',
      format: combine(
        timestamp({ format: dateFormatter }),
        printf(({ ip, timestamp, method, path, httpVersion, statusCode, contentLength, referer, userAgent, time, error }) => {
          return logFormats.access({
            ip,
            timestamp,
            method,
            path,
            httpVersion,
            statusCode,
            contentLength,
            referer,
            userAgent,
            time,
            error
          });
        })
      ),
      transports: [transport]
    });
  }

  public constructor() {
    this.createConsoleLogger();
    this.createErrorFileLogger();
    this.createAccessFileLogger();
  }

  public getErrorLogger(): WinstonLogger | null {
    return this.errorFileLogger;
  }

  public getAccessLogger(): WinstonLogger | null {
    return this.accessFileLogger;
  }

  /**
   * logs in info level
   * @param message The message to log
   * @param meta The optional metadata to append to the `message`
   * @returns This logger instance
   */
  public info(message: string, meta?: Record<string, unknown>): Logger {
    this.ttyLogger?.info(message, { sourcePath: getSourcePath(), meta });
    return this;
  }

  /**
   * logs in warn level
   * @param message The message to log
   * @param meta The optional metadata to append to the `message`
   * @returns This logger instance
   */
  public warn(message: string, meta?: Record<string, unknown>): Logger {
    this.ttyLogger?.warn(message, { sourcePath: getSourcePath(), meta });
    return this;
  }

  /**
   * logs in error level
   * @param message The message to log
   * @param meta The optional metadata to append to the `message`
   * @returns This logger instance
   */
  public error(message: string, meta?: Record<string, unknown>): Logger {
    const metaObject = { sourcePath: getSourcePath(), meta };
    this.ttyLogger?.error(message, metaObject);
    this.errorFileLogger?.error(message, metaObject);
    return this;
  }

  /**
   * Logs access event.
   * LogEntry contains common properties like in nginx, plus time the request took.
   * @param entry The Entry containing the access properties (ip, method, path, etc.)
   * @returns This logger instance
   */
  public access({ method, path, statusCode, contentLength, ...rest }: Omit<AccessLogEntry, 'timestamp'>): Logger {
    if (this.ttyLogger) {
      let level: 'info' | 'warn' | 'error' = 'info';
      if ((statusCode as number) >= 399) {
        level = 'error';
      } else if ((statusCode as number) >= 299 || (statusCode as number) < 200) {
        level = 'warn';
      }
      this.ttyLogger[level](`Access: ${method} ${path} - ${statusCode} - ${contentLength}`, { sourcePath: getSourcePath() });
    }
    this.accessFileLogger?.info('', { method, path, statusCode, contentLength, ...rest });
    return this;
  }
}

const setConsoleTest = function () {
  forceConsole = true;
  fileLogging = false;
};

const unsetConsoleTest = function () {
  forceConsole = false;
  fileLogging = true;
};

const setFileTest = function (withRotation: boolean) {
  forceConsole = true;
  rotation = withRotation;
};

const unsetFilTest = function () {
  forceConsole = false;
  rotation = true;
};

const setRotationTest = function () {
  rotationDatePattern = 'YYYY-MM-DD_HH-mm-ss';
  rotationMaxFiles = 3;
};

const unsetRotationTest = function () {
  rotationDatePattern = 'YYYY-MM-DD';
  rotationMaxFiles = 100;
};

export { Logger, setConsoleTest, unsetConsoleTest, setFileTest, unsetFilTest, setRotationTest, unsetRotationTest };
