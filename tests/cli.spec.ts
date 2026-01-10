import { Express } from 'express';
import mockFS from 'mock-fs';
import { program } from '@/cli';
import { exists } from '#/util';
import { getPort } from '@/server/handler/indexHandler';

interface HttpsConf {
  key: string;
  cert: string;
  allowHTTP1: boolean;
}

// noinspection SpellCheckingInspection
const CERT = `-----BEGIN CERTIFICATE-----
MIIFETCCAvkCFAv7EfZvRP8uFdkor9lwNtI5+BUuMA0GCSqGSIb3DQEBCwUAMEUx
CzAJBgNVBAYTAkRFMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRl
cm5ldCBXaWRnaXRzIFB0eSBMdGQwHhcNMjYwMTA0MTk1NzA5WhcNMjcwMTA0MTk1
NzA5WjBFMQswCQYDVQQGEwJERTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UE
CgwYSW50ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIICIjANBgkqhkiG9w0BAQEFAAOC
Ag8AMIICCgKCAgEArTTiqcklWIwBLyuZtPpWDziJEOiuaTspVDFJsdMrSSGh+gmW
VnGUt5MRw1CskmEd5zFU6rxq2Ewm5IV4RgxP9R07QQTBf2fkuRtBZ8VDvwiU43EN
enfzp0KLsWkjaJdqNxPnW/aDktA3mLKpg4uKJAO0PKK1adfm0zH3yTZ8oLq+7UT9
iFa0jaxtiiKG8Laz6awFicp/fDYTrYdRDI1QFmMTuh3XHHM/wUxLbBz1uqhSfY1M
ncc17tPHSHV7J7mldPekz04f9GE3ogW+gWoJ7VXpja6EGeRWg8X7XOrfBWhRZXVz
/c0x2btglLahFLlPlw8oEW/5ydjGj4/PTirbB51ivt6VToiC50hRXjxfi1fSrECd
/Tcdb8UUl4Tcwv795Nsc8dfIjcsVOjsRdB2O8lP4lpHrv4JCu89SIORSPZl4JXvA
akwViXhIEbvS4/Josr4V9KOcrLpBm1lQ/ZOg3jkcc3rPmzG7g3tCOghJXNSXscTf
EDLtK8lALtgGMTTljO8F7zRdyy8XM1JvsuKkYOVQ7UZmTKXiSHlQx1nh+H5RqfCd
ojYAE4uUIgKeT6qM6ysT5Xxs8tInjcnbx6aAujgQJLbjrbRa6MuncE0qaKOf0Fbm
UL0DyGbGzkvXy+9uXzrVOG3Bq7cpbl8NWw+iPW+dgOB16zZTh9izOyF5TUcCAwEA
ATANBgkqhkiG9w0BAQsFAAOCAgEACpAUiGzdR4kHtGoftUr1KYjQ1m75UfHqp99s
6AU7dzTr8G7MZZ54eiiFP+615R7SqzZpee5/6j00PT78XvagMwxXlrjkxb0dXmy3
BAfE9IWGrDHnQafvWxUF6vL8IpSdy58HdB5ld3D6xCKYKoyVG0jBbLgOa+CX9pmE
srF1iEZbuzcm9yi+Qm3A+fqNIVrpb5/VtFtuMA1QgQr5Erivwy+Ua3nei/OcYSgD
7MhX7+NdlXnvRIwHmlJnhP6FuWnPNidv3MMmLLminaEGsvBvNTJqD606YaREqiTq
p+fETkoHeqX1rjC1oWgGKCQ9bOvxK6kbnGTvfyhso2r50s/uuJYnqpJKZZv9YJnn
bcrGRs9Dhwe9dzdCPuEsQCxJgzkhWfdtsn1dD+xJmlh5FpJW39GWyubILlx6jdwV
VO5DbaEDA0C/IWVWXM/sJYFeCMSYpfMAXI+Lh9k2Uqq5aOj5cv/SpB1/Ghg6ncEl
0YF7CHMxyF6je71T8iF730lCCzJ43WhkAtywgPtMjpVzBoQ/gAA2ecXoC/fN59qs
xmkkPU+AKuvN+SV5WXWodaNjqi8nfPLtC3ee8npBPVbFi6WU3Uqa4QeevLqtVKm7
3mmGsNk4mxc1K68At2kEZ6uAA+7e2lz3Kjor77mcAfoFYE+dtdRzqTFFcH9Eyr/F
ZYT2NnE=
-----END CERTIFICATE-----
`;

// noinspection SpellCheckingInspection
const KEY = `-----BEGIN PRIVATE KEY-----
MIIJQQIBADANBgkqhkiG9w0BAQEFAASCCSswggknAgEAAoICAQCtNOKpySVYjAEv
K5m0+lYPOIkQ6K5pOylUMUmx0ytJIaH6CZZWcZS3kxHDUKySYR3nMVTqvGrYTCbk
hXhGDE/1HTtBBMF/Z+S5G0FnxUO/CJTjcQ16d/OnQouxaSNol2o3E+db9oOS0DeY
sqmDi4okA7Q8orVp1+bTMffJNnygur7tRP2IVrSNrG2KIobwtrPprAWJyn98NhOt
h1EMjVAWYxO6Hdcccz/BTEtsHPW6qFJ9jUydxzXu08dIdXsnuaV096TPTh/0YTei
Bb6BagntVemNroQZ5FaDxftc6t8FaFFldXP9zTHZu2CUtqEUuU+XDygRb/nJ2MaP
j89OKtsHnWK+3pVOiILnSFFePF+LV9KsQJ39Nx1vxRSXhNzC/v3k2xzx18iNyxU6
OxF0HY7yU/iWkeu/gkK7z1Ig5FI9mXgle8BqTBWJeEgRu9Lj8miyvhX0o5ysukGb
WVD9k6DeORxzes+bMbuDe0I6CElc1JexxN8QMu0ryUAu2AYxNOWM7wXvNF3LLxcz
Um+y4qRg5VDtRmZMpeJIeVDHWeH4flGp8J2iNgATi5QiAp5PqozrKxPlfGzy0ieN
ydvHpoC6OBAktuOttFroy6dwTSpoo5/QVuZQvQPIZsbOS9fL725fOtU4bcGrtylu
Xw1bD6I9b52A4HXrNlOH2LM7IXlNRwIDAQABAoICABrxX5LerbcE7Eg8pYfP6yQp
/LRLJZpL8CVfF2IYgaK6HxqodCDVQTd/IqO5wGZywfaNJ3LuRUaJLgGdO3TWBHgS
CH4YMctSS3N56GYuetfUC2kH1Hto/ldV1CoQO0hRSV3w9CvLgHMNfaB8pj7GrYHl
q5tFCihBQ/A1VSCRH7jW480/zppvNl3VZSK4NTpriTf/oMrq24LkXJJBOtvTfZJF
7jMk4inUSaYVaqQSKy1ScqaCHNlsPBj/C4BbegFXcQPtY881jWXz23YSI6y45Htt
QkveSkFG0ihkWzH8fR23uPWp3BWuXiNK8P6hHBR/sQBEBM0VmIsL8/MwASTdKL3Y
VwCvpa2LJMa1XqUAfCCnEcDshDZUqE4ijYyuEJFbiIPLv9OH5MQvLxiO2ejwW4w+
y6HMpCFebF6/VcVlp9zE2Z9QzqX1GrzXbM01LHI49L8FBRpdelXZ/TxvEx9Avsyv
ZVDl4bMCv3CezZD9DcLmsNctdLm2cVNw4Ux7jm0JBKIg1Y49purrecad1sAm21rA
ScHo/qLmXXJYBMnVNbvr+Tox494GgqXbF0vUPkmezpZmoxgUlyPOmTVtbHM5CkQb
nIcBGgLwPTZKZpvCScAVR2gJo7F4+gypdCrEbFZMQ0v93iBq02sbLmHL2na4HAv0
06ZCUGe/EkU4obe6wguVAoIBAQDhD4v9+1VleovBrlSeqWlKqCbKepLSjIiuW5pM
rVSvwrGntPPBBnn039tXXXKHG22ZqWxR9CzN0Y3guxjUu730tkTQjvkkwZxbqLgK
QX6AR8PBK8VfgmSU8P7MCwzC027BZS6v+Os947HvZR4DJaSIHfgnWjGcWOgxpRjU
hehCIJKMrphtyOFmggF6HgMFTAgrb5oywJ4PX9DG6dBSXIHoECWAJlFDfFOacXLW
WRbrm9rolXFsQhZzi7SPrlESHVUX9DB/HbPkD+FqNd9JTHrJqjN/CGbFZGOsl1Zv
E8zMQxBdUrwxBiCcHMXCQh1rJ+xyVtd4fV+JsPEy1Xr7qZ41AoIBAQDFBHXyVWnu
E6yLdkRPphu+VKVr9vjRAcjSAAlYcoslyazCY3PumOR9eDyZ1pcR+bZQhGlpQ8yM
S5VGByyJjF4zwgljkDGj3SMiohJW9iWDodguEU+1Sb86sfiXLaZJrP41on57Md7D
BwGqpVRN/pf0yta5iI6AznNS+34nsG8hwvPxn4uhX/noaCRoTLcRpwGCjyRTQO/d
jdzsKwcAGWRp2ttinZAxpAvvpmvviP0afkX0iQHgTJnOKqUXoIu/uys4oJPv1AmN
ZF2caHwP5SbkQWQ3KNTeiR2y+Fr06GPrkdt8aa4yqr7VQIor3FCZkpwzo9LUH1D9
OvVLwT1npZ0LAoIBAArT5adNfTlJoQmranTLr74gwuUA6qloi3bf/1drC2T9V/C6
mvORbTKjxni4jTcE0cwPw59ZwQIR7+J8/d/WPHhWgI8MId5r1iruvhP4PK7NRRS5
F2DV9CLaSVflvDJvW6fAR3O95QtwNfJPihcaq4TE9FhoVXSxLlKdH8mxu4/a41IT
YE//1yBIZuvKH9kUZFw6nU+Nxsz0jiXTv+sGelWA2V0F+ujlRVxr0tuPI7QoJmsE
LZXIxC3A7envuATIFnz1iZPECRCS1wR2HQz4ufuTzbBx5gffIZB/I3BqonK9Uz86
KMWvBsib9cO3zJSIMi76EJnCZmNIeQI6FRWgfnUCggEAf24ML8rpMjENeELtmirR
ZQDw4e0jMGScFKAra0bjE3TnRe/3q0q+9xyO7d3rZpgCQP/0Aj71DYVRrrKzLuBY
idemJPy97sP4ls0HWbHpv8MtxVYzHQnvIzK7nGTNWngHEH/imSI/eBuPC2XWKoBS
nuWXjvdxXISr+O9rwJYQu2CSUiUktiMSzCyX59I+0q8Xfe/ByguFWeMJEsQdygWi
egkxvw40lrcJdV9KDuum8bzc2HbJfN9u1/ejQq331fJk2UKbjRKzfv18ws6d99X6
msZk4HyLeshrKjgS9Lde8Z4svcLJBkKEHgCZnhbpFvvKBmie087RnojE4dPCOMjY
0wKCAQAtqZfBjo+WBtUrMbVySEG0R2BqGVK59LEB9PSI02EYPDnahogqLFW/aXfK
B3+QIhOCzd56uQFvQwBtRcI8VBxK3Gkyz8oeMxno85n4hZq5s7792VJMhBpA7diL
cEwKRddJDqVilfMLD1MMf8HnreILhcG0x1mR1BQND8UsbIj/PdnBocltekdgtc6L
UFMfBXPlSlfGKtHm+qaXv4C83i5zWWnF9d2yGSMXLHET0g3U96278adCAZXkFfh6
0GyZdvAk4Y6mxRRQJeKO1dmF9qgGQicFPA82TrfvcLOrK9e6KOEvD00JwW66Y17u
K14rvuWCamLxG4C3mM6qExHPaLgK
-----END PRIVATE KEY-----
`;

const keyHex = '6161616161616161616161616161616161616161';

let mocked_lastPort = -1;
let mocked_lastScheme = '';
let mocked_lastApp: Express | null = null;
let mocked_lastHttpsConf: HttpsConf | null = null;
let mocked_lastLoggedMessages: string[] = [];
let mocked_lastLoggedMetas: Record<string, unknown>[] = [];
let mocked_lastLoggedLevels: string[] = [];

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes(size: number) {
      return Buffer.from('a'.repeat(size), 'utf8');
    }
  };
});

jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return {
    ...actual,
    createServer(app: Express) {
      const server = actual.createServer(app);
      server.listen = function ({ port }: { port: number }, callback: () => void) {
        mocked_lastApp = app;
        mocked_lastPort = port;
        mocked_lastScheme = 'http';
        callback();
      };
      return server;
    }
  };
});

jest.mock('http2', () => {
  const actual = jest.requireActual('http2');
  return {
    ...actual,
    createSecureServer(conf: HttpsConf, app: Express) {
      const server = actual.createSecureServer(conf, app);
      server.listen = function ({ port }: { port: number }, callback: () => void) {
        mocked_lastApp = app;
        mocked_lastPort = port;
        mocked_lastScheme = 'https';
        mocked_lastHttpsConf = conf;
        callback();
      };
      return server;
    }
  };
});

jest.mock('@/logging/Logger', () => {
  return {
    Logger: class Logger {
      // noinspection JSUnusedGlobalSymbols
      public info(message: string, meta?: Record<string, unknown>): Logger {
        mocked_lastLoggedMessages.push(message);
        mocked_lastLoggedMetas.push(meta ?? {});
        mocked_lastLoggedLevels.push('info');
        return this;
      }
      // noinspection JSUnusedGlobalSymbols
      public error(message: string, meta?: Record<string, unknown>): Logger {
        mocked_lastLoggedMessages.push(message);
        mocked_lastLoggedMetas.push(meta ?? {});
        mocked_lastLoggedLevels.push('error');
        return this;
      }
    }
  };
});

describe('cli', (): void => {
  beforeEach(async (): Promise<void> => {
    mockFS({});
  });

  afterEach(async (): Promise<void> => {
    mocked_lastPort = -1;
    mocked_lastScheme = '';
    mocked_lastApp = null;
    mocked_lastHttpsConf = null;
    mockFS.restore();
    mocked_lastLoggedMessages = [];
    mocked_lastLoggedMetas = [];
    mocked_lastLoggedLevels = [];
  });

  const assertStartupLogs = function (port: number, scheme: string) {
    expect(mocked_lastLoggedMessages).toEqual([
      'First start, you will need init key for initial configuration. Key generated.',
      'Successfully started server.'
    ]);
    expect(mocked_lastLoggedMetas?.at(0)).toEqual({ key: keyHex });
    expect(mocked_lastLoggedMetas?.at(1)?.port).toBe(port);
    expect(mocked_lastLoggedMetas?.at(1)?.scheme).toEqual(scheme);
    expect(mocked_lastLoggedMetas?.at(1)?.startTime).toMatch(/^\d+ms$/iu);
    expect(mocked_lastLoggedLevels).toEqual(['info', 'info']);
  };

  test('starts http server on port 9000.', async () => {
    await program.parseAsync(['--port', '9000'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('http');
    expect(mocked_lastPort).toEqual(9000);
    expect(mocked_lastApp).toBeInstanceOf(Function);
    expect(await exists('./initKey')).toBe(true);
    expect(await exists('./ssl')).toBe(true);
    expect(getPort()).toEqual('9000');
    assertStartupLogs(9000, 'http');
  });

  test('starts https server on port 8000.', async () => {
    mockFS({ './ssl': { 'key.pem': KEY, 'cert.pem': CERT } });

    await program.parseAsync(['--port', '8000', '--scheme', 'https'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('https');
    expect(mocked_lastPort).toEqual(8000);
    expect(mocked_lastApp).toBeInstanceOf(Function);
    expect(mocked_lastHttpsConf).toEqual({ key: KEY, cert: CERT, allowHTTP1: true });
    expect(await exists('./initKey')).toBe(true);
    expect(await exists('./ssl')).toBe(true);
    expect(getPort()).toEqual('8000');
    assertStartupLogs(8000, 'https');
  });

  test('logs error if key.pem does not exist.', async () => {
    mockFS({ './ssl': { 'cert.pem': CERT } });

    await program.parseAsync(['--port', '8000', '--scheme', 'https'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(mocked_lastLoggedMessages).toEqual([
      'First start, you will need init key for initial configuration. Key generated.',
      'File ./ssl/key.pem does not exist.'
    ]);
    expect(mocked_lastLoggedMetas).toEqual([{ key: keyHex }, {}]);
    expect(mocked_lastLoggedLevels).toEqual(['info', 'error']);
  });

  test('logs error if cert.pem does not exist.', async () => {
    mockFS({ './ssl': { 'key.pem': KEY } });

    await program.parseAsync(['--port', '8000', '--scheme', 'https'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(mocked_lastLoggedMessages).toEqual([
      'First start, you will need init key for initial configuration. Key generated.',
      'File ./ssl/cert.pem does not exist.'
    ]);
    expect(mocked_lastLoggedMetas).toEqual([{ key: keyHex }, {}]);
    expect(mocked_lastLoggedLevels).toEqual(['info', 'error']);
  });

  test('logs error if key.pem is invalid.', async () => {
    mockFS({ './ssl': { 'key.pem': 'invalid key file', 'cert.pem': CERT } });

    await program.parseAsync(['--port', '8000', '--scheme', 'https'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(mocked_lastLoggedMessages).toEqual([
      'First start, you will need init key for initial configuration. Key generated.',
      'Could not start https server.'
    ]);
    expect(mocked_lastLoggedMetas).toEqual([{ key: keyHex }, { error: 'error:1E08010C:DECODER routines::unsupported' }]);
    expect(mocked_lastLoggedLevels).toEqual(['info', 'error']);
  });

  test('logs error on forbidden http, port 80.', async () => {
    await program.parseAsync(['--port', '80', '--scheme', 'http'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(await exists('./initKey')).toBe(false);
    expect(await exists('./ssl')).toBe(false);
    expect(mocked_lastLoggedMessages).toEqual(['http is only allowed if your application is behind a tls terminating proxy.']);
    expect(mocked_lastLoggedMetas).toEqual([{ port: '80', scheme: 'http' }]);
    expect(mocked_lastLoggedLevels).toEqual(['error']);
  });

  test('logs error on forbidden http, port 443.', async () => {
    await program.parseAsync(['--port', '443', '--scheme', 'http'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(await exists('./initKey')).toBe(false);
    expect(await exists('./ssl')).toBe(false);
    expect(mocked_lastLoggedMessages).toEqual(['http is only allowed if your application is behind a tls terminating proxy.']);
    expect(mocked_lastLoggedMetas).toEqual([{ port: '443', scheme: 'http' }]);
    expect(mocked_lastLoggedLevels).toEqual(['error']);
  });

  test('logs error on port 80 and https.', async () => {
    await program.parseAsync(['--port', '80', '--scheme', 'https'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(await exists('./initKey')).toBe(false);
    expect(await exists('./ssl')).toBe(false);
    expect(mocked_lastLoggedMessages).toEqual(['invalid port for https.']);
    expect(mocked_lastLoggedMetas).toEqual([{ port: '80', scheme: 'https' }]);
    expect(mocked_lastLoggedLevels).toEqual(['error']);
  });

  test('logs error on invalid scheme.', async () => {
    await program.parseAsync(['--port', '80', '--scheme', 'nope'], { from: 'user' });

    expect(mocked_lastScheme).toEqual('');
    expect(mocked_lastPort).toEqual(-1);
    expect(mocked_lastApp).toBeNull();
    expect(await exists('./initKey')).toBe(false);
    expect(await exists('./ssl')).toBe(false);
    expect(mocked_lastLoggedMessages).toEqual(['invalid scheme. Must be http or https.']);
    expect(mocked_lastLoggedMetas).toEqual([{ scheme: 'nope' }]);
    expect(mocked_lastLoggedLevels).toEqual(['error']);
  });
});
