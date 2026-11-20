import { DatabaseConflictError } from '@/db/errors/DatabaseConflictError';

describe('DatabaseConflictError', () => {
  test('is an Error with a database-independent name and default message', () => {
    const error = new DatabaseConflictError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DatabaseConflictError');
    expect(error.message).toBe('Resource already exists');
    expect(error.cause).toBeUndefined();
  });

  test('retains a custom diagnostic message and the original cause without enumerating it', () => {
    const cause = new Error('Private driver details');
    const error = new DatabaseConflictError('Username already exists', { cause });
    expect(error.message).toBe('Username already exists');
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.stringify(error)).not.toContain(cause.message);
  });
});
