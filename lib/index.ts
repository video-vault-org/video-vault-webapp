#!/usr/bin/env node
import { startServer } from './server';

startServer().then(
  ({ close }) => {
    const shutdown = () => {
      close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  },
  () => {
    process.exitCode = 1;
  }
);
