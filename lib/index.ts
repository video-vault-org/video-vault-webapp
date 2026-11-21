#!/usr/bin/env node
import { startServer } from './server';

/** Server bootstrap creates ./.salt before initializing adapters. */
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
