import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

type ResponseRequestResult = [boolean, Record<string, unknown>];
type ErrorRequestResult = [string];
type RequestResult = ResponseRequestResult | ErrorRequestResult;

const handleError = function (err: unknown): RequestResult {
  console.error((err as Error).message);
  if (axios.isAxiosError(err) && err.response) {
    return [false, err.response.data];
  }
  if (axios.isAxiosError(err)) {
    return ['axios-network-error'];
  }
  return ['axios-internal-error'];
};

const doGet = async function (path: string, token: string): Promise<RequestResult> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.get('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return handleError(err);
  }
};

const doPost = async function (path: string, token: string, body: Record<string, unknown>): Promise<RequestResult> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.post('/' + path.replace(/^\//, ''), body, conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return handleError(err);
  }
};

const doDelete = async function (path: string, token: string): Promise<RequestResult> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.delete('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return handleError(err);
  }
};

export { doPost, doGet, doDelete };
