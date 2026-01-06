import http from 'http';
import http2 from 'http2';
import { readFile, mkdir } from 'fs/promises';
import express from 'express';
import http2Express from 'http2-express-bridge';
import { Command } from 'commander';
import { description, version } from '../package.json';
import { buildApi } from '@/server/api';
import { initJwt } from '@/auth/jwt';
import { initialize } from '@/init';
import { loadLogger } from '@/logging';

const startHttpServer = async function (port: number, start: number): Promise<void> {
  const logger = loadLogger();
  const server = http.createServer(buildApi(true));
  server.listen({ port }, () => {
    const end = Date.now();
    const time = end - start;
    logger.info('Successfully started server.', { port, scheme: 'http', startTime: time + 'ms' });
  });
};

const startHttpsServer = async function (port: number, start: number): Promise<void> {
  const logger = loadLogger();
  const key = await readFile('./ssl/key.pem', 'utf8');
  const cert = await readFile('./ssl/cert.pem', 'utf8');
  const app = http2Express(express);
  app.use(buildApi(true));
  const server = http2.createSecureServer({ key, cert, allowHTTP1: true }, app);
  server.listen({ port }, () => {
    const end = Date.now();
    const time = end - start;
    logger.info('Successfully started server.', { port, scheme: 'https', startTime: time + 'ms' });
  });
};

const program = new Command();

// define application
program
  .name('VideoVault-WebApp')
  .description(`${description}.\nMore Information: https://github.com/video-vault-org/video-vault-webapp`)
  .version(version)
  .option('-p, --port <port>', 'Port on the application shall listen to', '9090')
  .option('-s, --scheme <scheme>', 'Protocol to use. http or https', 'http')
  .action(async ({ port, scheme }: { port?: string; scheme?: string }) => {
    const logger = loadLogger();
    const start = Date.now();
    if (scheme === 'http' && (port === '80' || port === '443')) {
      logger.error('http is only allowed if your application is behind a tls terminating proxy.', { port, scheme });
      return;
    }

    if (scheme === 'https' && port === '80') {
      logger.error('invalid port for https.', { port, scheme });
      return;
    }

    if (scheme !== 'https' && scheme !== 'http') {
      logger.error('invalid scheme. Must be http or https.', { scheme });
      return;
    }

    await initJwt();
    await initialize();
    await mkdir('./ssl', { recursive: true });

    if (scheme === 'http') {
      return await startHttpServer(parseInt(port ?? '-1'), start);
    }
    await startHttpsServer(parseInt(port ?? '-1'), start);
  });

export { program };
