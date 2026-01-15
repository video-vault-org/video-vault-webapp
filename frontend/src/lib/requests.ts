import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

interface ErrorBody {
  error: string;
}

type Body = Record<string, unknown>;
type BodyRequestResult<T extends Body> = [null, T];
type ErrorRequestResult = [string];
type RequestResult<T extends Body> = BodyRequestResult<T> | ErrorRequestResult;

const handleError = function <T extends Body>(err: unknown): RequestResult<T> {
  console.error((err as Error).message);
  if (axios.isAxiosError(err) && err.response) {
    return [(err.response.data as unknown as ErrorBody).error];
  }
  if (axios.isAxiosError(err)) {
    return ['axios-network-error'];
  }
  return ['axios-internal-error'];
};

const doGet = async function <T extends Body>(path: string, token: string): Promise<RequestResult<T>> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.get<T>('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return success ? [null, response.data] : [(response.data as unknown as ErrorBody).error];
  } catch (err: unknown) {
    return handleError<T>(err);
  }
};

const doPost = async function <S extends Body, C extends Body>(path: string, token: string, body: C): Promise<RequestResult<S>> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.post<S>('/' + path.replace(/^\//, ''), body, conf);
    const success = response.status >= 200 && response.status <= 299;
    return success ? [null, response.data] : [(response.data as unknown as ErrorBody).error];
  } catch (err: unknown) {
    return handleError<S>(err);
  }
};

const doDelete = async function <T extends Body>(path: string, token: string): Promise<RequestResult<T>> {
  try {
    const conf: AxiosRequestConfig = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.delete<T>('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return success ? [null, response.data] : [(response.data as unknown as ErrorBody).error];
  } catch (err: unknown) {
    return handleError<T>(err);
  }
};

export { doPost, doGet, doDelete };
