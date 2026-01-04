import { createLogger, format, transports, Logger as WinstonLogger, LogEntry } from 'winston';
import paths from 'path';
import process from 'process';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AccessLogEntry } from '@/logging/types/AccessLogEntry';
import { getSourcePath } from '@/logging/getSourcePath';

const { combine, timestamp, printf, colorize } = format;

let forceConsole = false;

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
    return colorize().colorize(level, `${timestamp} [${sourcePath}] ${level.toUpperCase()}: ${message}${metaPad}`);
  },
  json({ level, message, timestamp, sourcePath, meta }: LogEntry): string {
    const messageString = message as string;
    const messageProperty = messageString.includes('\n') ? messageString.split('\n') : messageString;
    const logObject = { timestamp, level, source: sourcePath, message: messageProperty, meta };
    return JSON.stringify(logObject);
  },
  access(accessLogEntry: AccessLogEntry): string {
    return JSON.stringify(accessLogEntry);
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
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: 100,
      createSymlink: true,
      filename: `${path}.%DATE%`,
      symlinkName: path,
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
    this.errorFileLogger = createLogger({
      exitOnError: false,
      level: 'error',
      format: combine(
        timestamp({ format: dateFormatter }),
        printf(({ level, message, timestamp, sourcePath, meta }) => {
          return logFormats.json({ level, message: message as string, timestamp, sourcePath, meta });
        })
      ),
      transports: [new DailyRotateFile(this.createRotationTransportOptions('/logs/error.log'))]
    });
  }

  private createAccessFileLogger() {
    this.accessFileLogger = createLogger({
      exitOnError: false,
      level: 'info',
      format: combine(
        timestamp({ format: dateFormatter }),
        printf(({ ip, timestamp, method, path, httpVersion, statusCode, contentLength, referer, userAgent, time }) => {
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
            time
          });
        })
      ),
      transports: [new DailyRotateFile(this.createRotationTransportOptions('./logs/access.log'))]
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
    this.accessFileLogger?.info('', { method, path, statusCode, contentLength, ...rest });
    const isApiRequest = /^\/api\//.test(path as string);
    if (!isApiRequest && (statusCode as number) < 400) {
      this.ttyLogger?.info(`Access: statusCode ${statusCode} on ${method} ${path}`, {
        sourcePath: getSourcePath(),
        meta: { method, path, statusCode, contentLength }
      });
    }
    return this;
  }
}

const setConsoleTest = function () {
  forceConsole = true;
};

const unsetConsoleTest = function () {
  forceConsole = false;
};

export { Logger, setConsoleTest, unsetConsoleTest };
