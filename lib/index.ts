#!/usr/bin/env node
import { startServer } from './server';
import { logger } from './http/logging';

startServer().then(
  ({ server, close }) => {
    const address = server.address();
    logger.info({ address }, 'VideoVault listening');
    const shutdown = () => {
      close().catch((error: unknown) => {
        logger.error({ err: error instanceof Error ? error : new Error('Unknown shutdown error') }, 'Shutdown failed');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  },
  (error: unknown) => {
    logger.error({ err: error instanceof Error ? error : new Error('Unknown startup error') }, 'Startup failed');
    process.exitCode = 1;
  }
);
