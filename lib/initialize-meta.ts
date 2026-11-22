#!/usr/bin/env node
import { initializeMetaConfig } from './cli/meta';
import { ensureInstanceSalt } from './util/instanceSalt';

/** Interactive CLI: npm run meta:init. Creates ./.salt if needed and saves frontend metadata settings to ./conf/meta.json. */
ensureInstanceSalt()
  .then(() => initializeMetaConfig())
  .then(() => {
    console.log('Metadata configuration initialization completed');
  })
  .catch(() => {
    console.error('Metadata configuration initialization failed: check answers, salt file and configuration file permissions');
    process.exitCode = 1;
  });
