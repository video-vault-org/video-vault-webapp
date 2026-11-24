/** Escapes text for HTML text nodes and quoted attribute values. */
const escapeHtml = function (value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
};

/** Sets the configured application title without interpreting it as HTML. Safe to apply repeatedly. */
const setPageTitle = function (html: string, title: string): string {
  const escaped = escapeHtml(title);
  return html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escaped}</title>`).replace(/<meta property="og:title" content="[^"]*"\s*\/?>/i, () => `<meta property="og:title" content="${escaped}" />`);
};

export { escapeHtml, setPageTitle };
