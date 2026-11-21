#!/usr/bin/env node
import { loadDb, resetDb } from './db';
import { initializeAdmin, readAdminInput } from './cli/admin';
import { ensureInstanceSalt } from './util/instanceSalt';

/** Interactive CLI: npm run admin:init. Requires the same ./conf/db.json as the HTTP server. */
async function main(): Promise<void> {
  try {
    await ensureInstanceSalt();
    const input = await readAdminInput();
    await initializeAdmin(await loadDb(), input);
    console.log('Initial admin created');
  } finally {
    await resetDb();
  }
}

main().catch(() => {
  // Do not print input values or validation errors that could contain credentials.
  console.error('Admin initialization failed: check answers, instance salt file, database configuration and whether an admin already exists');
  process.exitCode = 1;
});
