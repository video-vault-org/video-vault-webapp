import { Logger } from './Logger';

let logger: Logger | null;

const loadLogger = function (): Logger {
  if (!!logger) {
    return logger;
  }
  return (logger = new Logger());
};

export { loadLogger };
