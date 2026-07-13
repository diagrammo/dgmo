// ============================================================
// Math expression evaluator for `function` charts.
// Supports: +, -, *, /, ^, unary -, parens, sin, cos, tan,
// log (base 10), ln, exp, sqrt, abs, and constants pi, e.
//
// Hand-written recursive-descent parser — deliberately does NOT
// use `new Function`/`eval`, so the bundle stays statically
// analyzable (Obsidian scorecard, web-editor CSP, etc.).
//
// Returns NaN for invalid / non-finite results (callers break
// the path there).
// ============================================================

type Fn1 = (n: number) => number;

const FUNCS: Record<string, Fn1> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  // charAt returns '' past the end, so indexing never yields undefined.
  while (i < n) {
    const c = expr.charAt(i);
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i + 1;
      while (/[0-9.]/.test(expr.charAt(j))) j++;
      // optional scientific exponent: 1e3, 2.5E-4
      const exp = expr.charAt(j);
      if (exp === 'e' || exp === 'E') {
        let k = j + 1;
        const sign = expr.charAt(k);
        if (sign === '+' || sign === '-') k++;
        if (/[0-9]/.test(expr.charAt(k))) {
          while (/[0-9]/.test(expr.charAt(k))) k++;
          j = k;
        }
      }
      const num = Number(expr.slice(i, j));
      if (!isFinite(num)) throw new Error('bad number');
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i + 1;
      while (/[a-zA-Z0-9]/.test(expr.charAt(j))) j++;
      tokens.push({ t: 'id', v: expr.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error(`unexpected char: ${c}`);
  }
  return tokens;
}

// Recursive-descent parser/evaluator over the token stream.
class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private x: number
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(v: string): void {
    const tk = this.peek();
    if (tk?.t !== 'op' || tk.v !== v) throw new Error(`expected ${v}`);
    this.pos++;
  }

  evaluate(): number {
    const value = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new Error('trailing input');
    return value;
  }

  // expr = term (('+' | '-') term)*
  private parseExpr(): number {
    let value = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk?.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        this.pos++;
        const rhs = this.parseTerm();
        value = tk.v === '+' ? value + rhs : value - rhs;
      } else break;
    }
    return value;
  }

  // term = factor (('*' | '/') factor)*
  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      const tk = this.peek();
      if (tk?.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        this.pos++;
        const rhs = this.parseFactor();
        value = tk.v === '*' ? value * rhs : value / rhs;
      } else break;
    }
    return value;
  }

  // factor = ('+' | '-') factor | power
  private parseFactor(): number {
    const tk = this.peek();
    if (tk?.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      this.pos++;
      const operand = this.parseFactor();
      return tk.v === '-' ? -operand : operand;
    }
    return this.parsePower();
  }

  // power = primary ('^' factor)?  — right-associative
  private parsePower(): number {
    const base = this.parsePrimary();
    const tk = this.peek();
    if (tk?.t === 'op' && tk.v === '^') {
      this.pos++;
      const exponent = this.parseFactor();
      return base ** exponent;
    }
    return base;
  }

  // primary = number | const | 'x' | func '(' expr ')' | '(' expr ')'
  private parsePrimary(): number {
    const tk = this.peek();
    if (!tk) throw new Error('unexpected end');
    if (tk.t === 'num') {
      this.pos++;
      return tk.v;
    }
    if (tk.t === 'op' && tk.v === '(') {
      this.pos++;
      const value = this.parseExpr();
      this.eatOp(')');
      return value;
    }
    if (tk.t === 'id') {
      this.pos++;
      if (tk.v === 'x') return this.x;
      if (tk.v === 'pi') return Math.PI;
      if (tk.v === 'e') return Math.E;
      const fn = FUNCS[tk.v];
      if (fn) {
        this.eatOp('(');
        const arg = this.parseExpr();
        this.eatOp(')');
        return fn(arg);
      }
      throw new Error(`unknown identifier: ${tk.v}`);
    }
    throw new Error('unexpected token');
  }
}

export function evaluateExpression(expr: string, x: number): number {
  try {
    const result = new Parser(tokenize(expr), x).evaluate();
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}
