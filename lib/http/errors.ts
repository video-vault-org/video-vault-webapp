import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';

/** An HTTP failure whose message may be returned to the client. */
class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Sanitizes validation, multipart and database failures; internal details remain in server logs. */
const handleErrors = function (error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const failure = error instanceof Error ? error : new Error('Unknown server error');
  if (reply.raw.headersSent) {
    request.failure = failure;
    request.log.error({ err: failure }, 'Response failed after headers were sent');
    reply.raw.destroy();
    return;
  }

  const details = error as Partial<FastifyError> | null;
  let status = 500;
  let message = 'Internal server error';

  if (error instanceof HttpError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof DatabaseConflictError) {
    status = 409;
    message = 'Resource already exists';
  } else if (details?.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    status = 413;
    message = 'Request body too large';
  } else if (details?.code === 'FST_REQ_FILE_TOO_LARGE') {
    status = 413;
    message = 'Invalid upload';
  } else if (details?.validation || error instanceof URIError || (details?.statusCode && details.statusCode >= 400 && details.statusCode < 500)) {
    status = details?.statusCode ?? 400;
    message = 'Invalid request';
  }
  if (status >= 500) request.failure = failure;

  reply.code(status).send({ error: message });
};

export { HttpError, handleErrors };
