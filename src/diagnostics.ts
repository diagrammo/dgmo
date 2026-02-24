// ============================================================
// Structured Diagnostic Types
// ============================================================

export type DgmoSeverity = 'error' | 'warning';

export interface DgmoError {
  line: number; // 1-based (0 = no line info)
  column?: number; // optional 1-based column
  message: string; // without "Line N:" prefix
  severity: DgmoSeverity;
}

export function makeDgmoError(
  line: number,
  message: string,
  severity: DgmoSeverity = 'error'
): DgmoError {
  return { line, message, severity };
}

export function formatDgmoError(err: DgmoError): string {
  return err.line > 0 ? `Line ${err.line}: ${err.message}` : err.message;
}

// ============================================================
// "Did you mean?" Suggestions
// ============================================================

/**
 * Simple Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array(n + 1)
    .fill(0)
    .map((_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Returns a "did you mean 'X'?" suggestion if the input is close to one of the candidates.
 * Returns null if no good match is found.
 * Threshold: distance ≤ max(2, floor(input.length / 3))
 */
export function suggest(input: string, candidates: readonly string[]): string | null {
  if (!input || candidates.length === 0) return null;
  const lower = input.toLowerCase();
  const threshold = Math.max(2, Math.floor(lower.length / 3));

  let best: string | null = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    const dist = levenshtein(lower, c.toLowerCase());
    if (dist < bestDist && dist <= threshold && dist > 0) {
      bestDist = dist;
      best = c;
    }
  }

  return best ? `Did you mean '${best}'?` : null;
}
