// Shared grammar for an `era` endpoint that names an element on the axis
// (#2373 gantt tasks/groups, #2405 timeline events/lanes).
//
//   era <from> -> <to> [label] [color]
//
// Each endpoint is a literal axis position (a date, a `+offset`) or a name.
// A named start resolves to the element's start, a named end to its end, and
// the resolution happens after layout so the band follows the element.
//
// The name on the right shares the line with the label, so the boundary is
// found by trying the longest leading run of words that names an element.

/** Split `A -> B …` at the first arrow outside quotes and brackets. */
export function splitEraArrow(
  s: string
): { left: string; right: string } | null {
  let quote = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (s.startsWith('->', i) || s.startsWith('–>', i)) {
        // Both arrows (`->`, `–>`) are two UTF-16 units.
        return { left: s.slice(0, i).trim(), right: s.slice(i + 2).trim() };
      }
    }
  }
  return null;
}

/** Words of `s`, keeping a `"quoted span"` or a `[bracketed span]` whole. */
export function anchorTokens(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = false;
  let depth = 0;
  for (const c of s) {
    if (c === '"') quote = !quote;
    else if (!quote && c === '[') depth++;
    else if (!quote && c === ']') depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && /\s/.test(c)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The longest leading run of words in `s` that `resolve` accepts, and the
 * words left over (the label). Null when no leading run names anything.
 */
export function leadingName<T>(
  s: string,
  resolve: (name: string) => T | null
): { hit: T; name: string; rest: string } | null {
  const tokens = anchorTokens(s);
  for (let k = tokens.length; k >= 1; k--) {
    const name = tokens.slice(0, k).join(' ');
    const hit = resolve(name);
    if (hit != null) return { hit, name, rest: tokens.slice(k).join(' ') };
  }
  return null;
}

/** `[Name]` → `Name`; anything else → null. */
export function bracketName(s: string): string | null {
  const m = s.trim().match(/^\[(.+)\]$/);
  return m ? m[1]!.trim() : null;
}

/** The error for an endpoint that names nothing; `takes` lists the forms. */
export function unknownEraName(name: string, takes: string): string {
  return `era: nothing named "${name}" — an era end takes ${takes}.`;
}
