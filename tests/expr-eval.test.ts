import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../src/utils/expr-eval';

describe('evaluateExpression', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(evaluateExpression('2 + 3 * 4', 0)).toBe(14);
    expect(evaluateExpression('(2 + 3) * 4', 0)).toBe(20);
    expect(evaluateExpression('10 / 2 - 3', 0)).toBe(2);
  });

  it('substitutes x', () => {
    expect(evaluateExpression('2*x + 1', 3)).toBe(7);
    expect(evaluateExpression('x', 42)).toBe(42);
  });

  it('handles the cannonball example expressions', () => {
    expect(evaluateExpression('-0.001*x^2 + 0.27*x', 100)).toBeCloseTo(17, 6);
    expect(evaluateExpression('-0.003*x^2 + 0.75*x', 50)).toBeCloseTo(30, 6);
  });

  it('handles powers right-associatively', () => {
    expect(evaluateExpression('x^2', 5)).toBe(25);
    expect(evaluateExpression('2^3^2', 0)).toBe(512); // 2^(3^2)
    expect(evaluateExpression('x^-1', 4)).toBe(0.25);
  });

  it('applies unary minus', () => {
    expect(evaluateExpression('-x', 5)).toBe(-5);
    expect(evaluateExpression('-(2 + 3)', 0)).toBe(-5);
    expect(evaluateExpression('3 - -2', 0)).toBe(5);
  });

  it('supports math functions', () => {
    expect(evaluateExpression('sin(0)', 0)).toBe(0);
    expect(evaluateExpression('cos(0)', 0)).toBe(1);
    expect(evaluateExpression('sqrt(x)', 16)).toBe(4);
    expect(evaluateExpression('abs(x)', -7)).toBe(7);
    expect(evaluateExpression('exp(0)', 0)).toBe(1);
    expect(evaluateExpression('ln(e)', 0)).toBeCloseTo(1, 12);
    expect(evaluateExpression('log(1000)', 0)).toBeCloseTo(3, 12);
  });

  it('knows constants pi and e', () => {
    expect(evaluateExpression('pi', 0)).toBeCloseTo(Math.PI, 12);
    expect(evaluateExpression('e', 0)).toBeCloseTo(Math.E, 12);
    expect(evaluateExpression('sin(pi/2)', 0)).toBeCloseTo(1, 12);
  });

  it('is case-insensitive for names', () => {
    expect(evaluateExpression('SIN(0)', 0)).toBe(0);
    expect(evaluateExpression('2*X', 4)).toBe(8);
    expect(evaluateExpression('PI', 0)).toBeCloseTo(Math.PI, 12);
  });

  it('accepts scientific-notation numbers', () => {
    expect(evaluateExpression('1e3', 0)).toBe(1000);
    expect(evaluateExpression('2.5e-1 * x', 4)).toBe(1);
  });

  it('returns NaN for invalid input', () => {
    expect(evaluateExpression('', 0)).toBeNaN();
    expect(evaluateExpression('2 +', 0)).toBeNaN();
    expect(evaluateExpression('(2 + 3', 0)).toBeNaN();
    expect(evaluateExpression('foo(2)', 0)).toBeNaN();
    expect(evaluateExpression('2 3', 0)).toBeNaN();
    expect(evaluateExpression('sin 2', 0)).toBeNaN();
  });

  it('returns NaN for non-finite results', () => {
    expect(evaluateExpression('1/0', 0)).toBeNaN();
    expect(evaluateExpression('sqrt(x)', -1)).toBeNaN();
    expect(evaluateExpression('ln(0)', 0)).toBeNaN();
  });

  it('does not execute injected code', () => {
    // Previously `new Function` would have run these.
    expect(evaluateExpression('process', 0)).toBeNaN();
    expect(evaluateExpression('globalThis', 0)).toBeNaN();
    expect(evaluateExpression('1);throw new Error("x");(1', 0)).toBeNaN();
  });
});
