// ============================================================
// Description Helpers — shared utilities for node descriptions
// ============================================================

/**
 * Try to strip a leading `description:` keyword from a line.
 * Matches only the colon form: `description: text`.
 * The bare form (`description text`) returns `needsColon: true`
 * so callers can emit a diagnostic.
 */
export function tryStripDescriptionKeyword(line: string): {
  isKeyword: boolean;
  needsColon?: boolean;
  text: string;
} {
  const colonMatch = line.match(/^description\s*:\s+(.+)$/i);
  if (colonMatch) return { isKeyword: true, text: colonMatch[1]! };
  const bareMatch = line.match(/^description\s+(.+)$/i);
  if (bareMatch)
    return { isKeyword: true, needsColon: true, text: bareMatch[1]! };
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
