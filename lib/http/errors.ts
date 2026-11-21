import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';
import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';

/** An HTTP failure whose message may be returned to the client. */
class HttpError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Returns consistent JSON errors without exposing database errors, credentials or stack traces. */
const handleErrors: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (response.headersSent) {
    response.err = error instanceof Error ? error : new Error('Unknown server error');
    request.log.error({ err: response.err }, 'Response failed after headers were sent');
    response.destroy();
    return;
  }
  if (error instanceof HttpError) {
    if (error.status >= 500) response.err = error;
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Invalid upload' });
    return;
  }
  const details = error as { type?: string } | null;
  if (details?.type === 'entity.too.large') {
    response.status(413).json({ error: 'Request body too large' });
    return;
  }
  if (error instanceof ZodError || error instanceof URIError || details?.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Invalid request' });
    return;
  }
  if (error instanceof DatabaseConflictError) {
    response.status(409).json({ error: 'Resource already exists' });
    return;
  }
  response.err = error instanceof Error ? error : new Error('Unknown server error');
  response.status(500).json({ error: 'Internal server error' });
};

export { HttpError, handleErrors };
