interface AccessLogEntry {
  ip: unknown;
  timestamp: unknown;
  method: unknown;
  path: unknown;
  httpVersion: unknown;
  statusCode: unknown;
  contentLength: unknown;
  referer: unknown;
  userAgent: unknown;
  time: unknown;
  error?: unknown;
}

export { AccessLogEntry };
