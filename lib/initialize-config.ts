#!/usr/bin/env node
import { initializeConfig } from './cli/config';
import { ensureInstanceSalt } from './util/instanceSalt';

/** Interactive CLI: npm run config:init. Ensures ./.salt exists, then configures the database and storage. */
ensureInstanceSalt()
  .then(() => initializeConfig())
  .then(() => {
    console.log('Database and storage configuration saved');
  })
  .catch(() => {
    // Configuration and validation errors can contain credentials; never print them.
    console.error('Configuration initialization failed: check answers, instance salt file and configuration file permissions');
    process.exitCode = 1;
  });
