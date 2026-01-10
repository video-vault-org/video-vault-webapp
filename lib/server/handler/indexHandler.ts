import { existsSync, readdirSync } from 'fs';
import express from 'express';
import { loadConfig as loadFrontendConfig } from '@/frontend';

let port = '9090';

let js = '';
let css = '';

const setJsAndCss = function () {
  if (!js || !css) {
    const exists = existsSync('./frontend/dist/assets');
    if (!exists) {
      return;
    }
    const files = exists ? readdirSync('./frontend/dist/assets') : [];
    js = files.find((file) => file.endsWith('.js')) ?? 'index.js';
    css = files.find((file) => file.endsWith('.css')) ?? 'index.css';
  }
};

const setPort = function (portToSet: string): void {
  port = portToSet;
};

const getPort = function (): string {
  return port;
};

const getHtml = function (logoDirName: string, title: string, description: string, baseUrl: string): string {
  setJsAndCss();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo/${logoDirName}/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${baseUrl}/" />
    <meta property="og:image" content="${baseUrl}/logo/${logoDirName}/og-image.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${baseUrl}/logo/${logoDirName}/og-image.jpg" />
    <title>${title}</title>
    <script type="module" crossorigin src="/assets/${js}"></script>
    <link rel="stylesheet" crossorigin href="/assets/${css}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
};

const indexHandler: express.RequestHandler = async function (req, res) {
  const config = await loadFrontendConfig();
  const logoDirName = config?.logo ?? 'default';
  const title = config?.title ?? 'VideoVault';
  const description = config?.description ?? 'Progressive Web App for end-to-end encrypted video collection.';
  const { protocol, hostname } = req;
  const portStr = port === '80' || port === '443' ? '' : `:${port}`;
  const baseUrl = `${protocol}://${hostname}${portStr}`;
  const html = getHtml(logoDirName, title, description, baseUrl);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};

const redirectDirectHandler: express.RequestHandler = async function (_req, res) {
  res.redirect(301, '/');
};

setJsAndCss();

export { setPort, getPort, indexHandler, redirectDirectHandler };
