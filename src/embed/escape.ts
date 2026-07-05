const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}

export function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}
