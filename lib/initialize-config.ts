#!/usr/bin/env node
import { initializeConfig } from './cli/config';
import { ensurePepper } from './util/pepper';

/** Interactive CLI: npm run config:init. Ensures ./.pepper exists, then configures the database and storage. */
ensurePepper()
  .then(() => initializeConfig())
  .then(() => {
    console.log('Database and storage configuration saved');
  })
  .catch(() => {
    // Configuration and validation errors can contain credentials; never print them.
    console.error('Configuration initialization failed: check answers, pepper file and configuration file permissions');
    process.exitCode = 1;
  });
