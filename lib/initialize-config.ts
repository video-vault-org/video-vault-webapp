#!/usr/bin/env node
import { initializeConfig } from './cli/config';

/** Interactive CLI: npm run config:init. Configures the database first, then storage. */
initializeConfig()
  .then(() => {
    console.log('Database and storage configuration saved');
  })
  .catch(() => {
    // Configuration and validation errors can contain credentials; never print them.
    console.error('Configuration initialization failed: check answers and configuration file permissions');
    process.exitCode = 1;
  });
