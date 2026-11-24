import { createHttpServer } from '@/http/app';

describe('trusted reverse proxies', () => {
  const original = process.env.VIDEO_VAULT_TRUST_PROXY;

  afterEach(() => {
    if (original === undefined) delete process.env.VIDEO_VAULT_TRUST_PROXY;
    else process.env.VIDEO_VAULT_TRUST_PROXY = original;
  });

  test.each([undefined, '', '   '])('trusts IPv4 and IPv6 loopback by default when the environment setting is %j', async (value) => {
    if (value === undefined) delete process.env.VIDEO_VAULT_TRUST_PROXY;
    else process.env.VIDEO_VAULT_TRUST_PROXY = value;
    const app = createHttpServer({ logger: false });
    app.get('/', async (request) => ({ host: request.host, protocol: request.protocol }));
    const headers = { host: 'internal:3210', 'x-forwarded-host': 'videos.example.org', 'x-forwarded-proto': 'https' };
    try {
      for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
        expect((await app.inject({ url: '/', remoteAddress, headers })).json()).toEqual({ host: 'videos.example.org', protocol: 'https' });
      }
      for (const remoteAddress of ['192.0.2.1', '2001:db8::1']) {
        expect((await app.inject({ url: '/', remoteAddress, headers })).json()).toEqual({ host: 'internal:3210', protocol: 'http' });
      }
    } finally {
      await app.close();
    }
  });

  test('a configured proxy list replaces rather than extends the loopback defaults', async () => {
    process.env.VIDEO_VAULT_TRUST_PROXY = '192.0.2.10,2001:db8::10';
    const app = createHttpServer({ logger: false });
    app.get('/', async (request) => ({ host: request.host, protocol: request.protocol }));
    const headers = { host: 'internal:3210', 'x-forwarded-host': 'videos.example.org', 'x-forwarded-proto': 'https' };
    try {
      for (const remoteAddress of ['192.0.2.10', '2001:db8::10']) {
        expect((await app.inject({ url: '/', remoteAddress, headers })).json()).toEqual({ host: 'videos.example.org', protocol: 'https' });
      }
      for (const remoteAddress of ['127.0.0.1', '::1', '192.0.2.11']) {
        expect((await app.inject({ url: '/', remoteAddress, headers })).json()).toEqual({ host: 'internal:3210', protocol: 'http' });
      }
    } finally {
      await app.close();
    }
  });
});
