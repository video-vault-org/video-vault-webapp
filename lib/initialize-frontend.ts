#!/usr/bin/env node
import { initializeFrontendConfig } from './cli/frontend';
import { ensureInstanceSalt } from './util/instanceSalt';

/** Interactive image selection: npm run frontend:init. Creates the instance salt if absent. */
ensureInstanceSalt()
  .then(() => initializeFrontendConfig())
  .then(() => {
    console.log('Frontend configuration initialization completed');
  })
  .catch(() => {
    console.error('Frontend configuration initialization failed: check image sets, answers, instance salt file and configuration file permissions');
    process.exitCode = 1;
  });
