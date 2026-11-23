const port = process.env.VIDEO_VAULT_PORT ?? '3210';

try {
  const response = await fetch(`http://127.0.0.1:${port}/bootstrap`, { signal: AbortSignal.timeout(4000) });
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
