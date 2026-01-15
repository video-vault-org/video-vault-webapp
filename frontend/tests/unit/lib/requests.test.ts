import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import AxiosMockAdapter from 'axios-mock-adapter';
import { doGet, doPost, doDelete } from '../../../src/lib/requests.ts';

describe('requests', () => {
  const token = 'test-token';
  let mock: AxiosMockAdapter;

  beforeEach(() => {
    mock = new AxiosMockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  describe('doGet', () => {
    it('returns success=true for 2xx response', async () => {
      mock.onGet('/test').reply(200, { foo: 'bar' });

      const result = await doGet('/init', token);

      expect(result).toEqual([true, { foo: 'bar' }]);
    });

    it('returns error response data on axios response error', async () => {
      mock.onGet('/test').reply(400, { error: 'bad-request' });

      const result = await doGet('/test', token);

      expect(result).toEqual([false, { error: 'bad-request' }]);
    });

    it('returns network error on axios network error', async () => {
      mock.onGet('/test').networkError();

      const result = await doGet('/test', token);

      expect(result).toEqual(['axios-network-error']);
    });

    it('returns internal error for non-axios error', async () => {
      mock.onGet('/test').reply(() => {
        throw new Error('boom');
      });

      const result = await doGet('/test', token);

      expect(result).toEqual(['axios-internal-error']);
    });

    it('sets Authorization header', async () => {
      mock.onGet('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doGet('test', token);
    });
  });

  describe('doPost', () => {
    it('returns success=true for 2xx response', async () => {
      mock.onPost('/test', { name: 'foo' }).reply(201, { id: 1 });

      const result = await doPost('/test', token, { name: 'foo' });

      expect(result).toEqual([true, { id: 1 }]);
    });

    it('returns network error on axios network error', async () => {
      mock.onPost('/test', {}).networkError();

      const result = await doPost('/test', token, {});

      expect(result).toEqual(['axios-network-error']);
    });

    it('sets Authorization header', async () => {
      mock.onPost('/test', {}).reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doPost('/test', token, {});
    });
  });

  describe('doDelete', () => {
    it('returns success=true for 2xx response', async () => {
      mock.onDelete('/test').reply(204, {});

      const result = await doDelete('/test', token);

      expect(result).toEqual([true, {}]);
    });

    it('returns network error on axios network error', async () => {
      mock.onDelete('/test').networkError();

      const result = await doDelete('/test', token);

      expect(result).toEqual(['axios-network-error']);
    });

    it('sets Authorization header', async () => {
      mock.onDelete('/test').reply((config) => {
        expect(config.headers?.Authorization).toBe(`Bearer ${token}`);
        return [200, {}];
      });

      await doDelete('/test', token);
    });
  });
});
