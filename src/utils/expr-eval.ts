// ============================================================
// Math expression evaluator for `function` charts.
// Supports: +, -, *, /, ^, sin, cos, tan, log, ln, exp, sqrt, abs, pi, e
// Returns NaN for invalid / non-finite results (callers break the path there).
// ============================================================

export function evaluateExpression(expr: string, x: number): number {
  try {
    const processed = expr
      .replace(/\bpi\b/gi, String(Math.PI))
      .replace(/\be\b/g, String(Math.E))
      .replace(/\bsin\s*\(/gi, 'Math.sin(')
      .replace(/\bcos\s*\(/gi, 'Math.cos(')
      .replace(/\btan\s*\(/gi, 'Math.tan(')
      .replace(/\bln\s*\(/gi, 'Math.log(')
      .replace(/\blog\s*\(/gi, 'Math.log10(')
      .replace(/\bexp\s*\(/gi, 'Math.exp(')
      .replace(/\bsqrt\s*\(/gi, 'Math.sqrt(')
      .replace(/\babs\s*\(/gi, 'Math.abs(')
      .replace(/\bx\b/gi, `(${x})`)
      .replace(/\^/g, '**');
    const result = new Function(`return ${processed}`)() as unknown;
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}
