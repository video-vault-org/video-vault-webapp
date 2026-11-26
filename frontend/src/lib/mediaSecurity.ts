/** Decrypted user bytes must never become an executable same-origin HTML document. */
const mediaHeaders = function (mime: string): Record<string, string> {
  return {
    'Content-Type': /^(?:video|audio)\/[\w.+-]+(?:;[^\r\n]*)?$/.test(mime)
      ? mime
      : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
};

export { mediaHeaders };
