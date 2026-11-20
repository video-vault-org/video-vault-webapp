#!/usr/bin/env node
import { startServer } from './server';

startServer().then(
  ({ server, close }) => {
    const address = server.address();
    console.log(`VideoVault listening on ${typeof address === 'object' && address ? address.port : address}`);
    const shutdown = () => {
      close().catch((error: unknown) => {
        console.error('Shutdown failed', error instanceof Error ? error.message : 'Unknown error');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  },
  (error: unknown) => {
    console.error('Startup failed', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  }
);
