import axios from 'axios';

type ResponseRequestResult = [boolean, Record<string, unknown>];
type ErrorRequestResult = [Error];
type RequestResult = ResponseRequestResult | ErrorRequestResult;

const doGet = async function (path: string, token: string): Promise<RequestResult> {
  try {
    const conf = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.get('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return [err as Error];
  }
};

const doPost = async function (path: string, token: string, body: Record<string, unknown>): Promise<RequestResult> {
  try {
    const conf = { headers: { Authorization: `Bearer ${token}` }, body };
    const response = await axios.post('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return [err as Error];
  }
};

const doDelete = async function (path: string, token: string): Promise<RequestResult> {
  try {
    const conf = { headers: { Authorization: `Bearer ${token}` } };
    const response = await axios.delete('/' + path.replace(/^\//, ''), conf);
    const success = response.status >= 200 && response.status <= 299;
    return [success, response.data];
  } catch (err: unknown) {
    return [err as Error];
  }
};

export { doPost, doGet, doDelete };
