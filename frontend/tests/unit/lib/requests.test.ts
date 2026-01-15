import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import { doGet, doPost, doDelete, download } from '../../../src/lib/requests.ts';

type TestBodyType = { foo: string };
type TestErrorBodyType = { error: string };

let errorSpy: ReturnType<typeof vi.spyOn>;
let loggedMessage = '';

describe('requests', () => {
  const token = 'test-token';
  let mock: AxiosMockAdapter;

  beforeEach(() => {
    mock = new AxiosMockAdapter(axios);
    errorSpy = vi.spyOn(console, 'error').mockImplementation((message) => {
      loggedMessage = message;
    });
  });

  afterEach(() => {
    mock.restore();
    errorSpy?.mockRestore();
    loggedMessage = '';
  });

  describe('doGet', () => {
    it('returns success=true for 2xx response.', async () => {
      mock.onGet('/test').reply(200, { foo: 'bar' });

      const result = await doGet<TestBodyType>('/test', token);

      expect(result).toEqual([null, { foo: 'bar' }]);
    });

    it('returns error response data on axios response error.', async () => {
      mock.onGet('/test').reply(400, { error: 'bad-request' });

      const result = await doGet<TestErrorBodyType>('/test', token);

      expect(result).toEqual(['bad-request']);
    });

    it('returns network error on axios network error.', async () => {
      mock.onGet('/test').networkError();

      const result = await doGet<TestErrorBodyType>('/test', token);

      expect(result).toEqual(['axios-network-error']);
    });

    it('returns internal error for non-axios error.', async () => {
      mock.onGet('/test').reply(() => {
        throw new Error('boom');
      });

      const result = await doGet<TestErrorBodyType>('/test', token);

      expect(result).toEqual(['axios-internal-error']);
    });

    it('logs internal error for non-axios error to console.', async () => {
      mock.onGet('/test').reply(() => {
        throw new Error('boom');
      });

      await doGet<TestErrorBodyType>('/test', token);

      expect(loggedMessage).toEqual('boom');
    });

    it('sets Authorization header.', async () => {
      mock.onGet('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doGet('test', token);
    });
  });

  describe('doPost', () => {
    it('returns success=true for 2xx response.', async () => {
      mock.onPost('/test', { name: 'foo' }).reply(201, { id: 1 });

      const result = await doPost<{ id: number }, { name: string }>('/test', token, { name: 'foo' });

      expect(result).toEqual([null, { id: 1 }]);
    });

    it('returns network error on axios network error.', async () => {
      mock.onPost('/test', {}).networkError();

      const result = await doPost<Record<never, never>, Record<never, never>>('/test', token, {});

      expect(result).toEqual(['axios-network-error']);
    });

    it('sets Authorization header.', async () => {
      mock.onPost('/test', {}).reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doPost<Record<never, never>, Record<never, never>>('/test', token, {});
    });
  });

  describe('doDelete', () => {
    it('returns success=true for 2xx response.', async () => {
      mock.onDelete('/test').reply(204, {});

      const result = await doDelete<Record<never, never>>('/test', token);

      expect(result).toEqual([null, {}]);
    });

    it('returns network error on axios network error.', async () => {
      mock.onDelete('/test').networkError();

      const result = await doDelete<Record<never, never>>('/test', token);

      expect(result).toEqual(['axios-network-error']);
    });

    it('sets Authorization header.', async () => {
      mock.onDelete('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doDelete<Record<never, never>>('/test', token);
    });
  });

  describe('download', () => {
    it('downloads file successfully.', async () => {
      const testBlob = new Blob();
      mock.onGet('/test').reply((config) => {
        expect(config.responseType).toBe('blob');
        return [200, testBlob];
      });

      const result = await download('/test', token);

      expect(result).toEqual([null, testBlob]);
    });

    it('returns specific error.', async () => {
      mock.onGet('/test').reply(401, { error: 'unauthorized' });

      const result = await download('/test', token);

      expect(result).toEqual(['unauthorized']);
    });

    it('returns network-error.', async () => {
      mock.onGet('/test').networkError();

      const result = await download('/test', token);

      expect(result).toEqual(['axios-network-error']);
    });

    it('returns internal-error.', async () => {
      mock.onGet('/test').reply(() => {
        throw new Error('boom');
      });

      const result = await download('/test', token);

      expect(result).toEqual(['axios-internal-error']);
    });

    it('logs internal error for non-axios error to console.', async () => {
      mock.onGet('/test').reply(() => {
        throw new Error('boom');
      });

      await download('/test', token);

      expect(loggedMessage).toEqual('boom');
    });

    it('sets Authorization header.', async () => {
      mock.onGet('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [400, { error: 'someError' }];
      });

      await download('/test', token);
    });
  });
});
