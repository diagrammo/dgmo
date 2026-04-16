// ============================================================
// Description Helpers — shared utilities for node descriptions
// ============================================================

/**
 * Try to strip a leading `description` keyword from a line.
 * Matches: `description text`, `description: text` (colon optional).
 * Does NOT match bare `description` with no trailing text.
 */
export function tryStripDescriptionKeyword(line: string): {
  isKeyword: boolean;
  text: string;
} {
  const match = line.match(/^description\s*:?\s+(.+)$/i);
  if (match) return { isKeyword: true, text: match[1] };
  return { isKeyword: false, text: line };
}

/**
 * Pre-process a single description line:
 * - `- text` → `• text` (bullet)
 * - `http example.com` → `https://example.com` (bare URL normalization)
 */
export function preprocessDescriptionLine(line: string): string {
  // Bullet transform
  if (line.startsWith('- ')) line = '\u2022 ' + line.slice(2);
  // Bare URL normalization
  line = line.replace(
    /\bhttps?\s+([\w][\w.-]+\.[a-z]{2,}(?:\/\S*)?)/gi,
    (_, domain) => `https://${domain}`
  );
  return line;
}
