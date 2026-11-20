/** A database-independent uniqueness or conditional-write conflict; contains no HTTP-specific information. */
class DatabaseConflictError extends Error {
  public readonly cause?: unknown;

  /**
   * @param message A description for internal diagnostics, not an HTTP response.
   * @param options The original driver error, retained as a non-enumerable cause when supplied.
   */
  public constructor(message = 'Resource already exists', options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'DatabaseConflictError';
    if ('cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, configurable: true, writable: true });
    }
  }
}

export { DatabaseConflictError };
