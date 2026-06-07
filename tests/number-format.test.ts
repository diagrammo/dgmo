import { describe, it, expect } from 'vitest';
import { compactNumber } from '../src/utils/number-format';

describe('compactNumber', () => {
  it('prints integers below 1000 bare', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(42)).toBe('42');
    expect(compactNumber(999)).toBe('999');
  });
  it('prints sub-1000 non-integers to one decimal', () => {
    expect(compactNumber(3.2)).toBe('3.2');
    expect(compactNumber(0.45)).toBe('0.5');
  });
  it('abbreviates thousands / millions / billions / trillions', () => {
    expect(compactNumber(1000)).toBe('1K');
    expect(compactNumber(1100)).toBe('1.1K');
    expect(compactNumber(39_500_000)).toBe('39.5M');
    expect(compactNumber(2_300_000_000)).toBe('2.3B');
    expect(compactNumber(1_400_000_000_000)).toBe('1.4T');
  });
  it('drops a trailing .0 (39.0M → 39M)', () => {
    expect(compactNumber(39_000_000)).toBe('39M');
    expect(compactNumber(2_000)).toBe('2K');
  });
  it('keeps the sign on negatives', () => {
    expect(compactNumber(-39_500_000)).toBe('-39.5M');
    expect(compactNumber(-3.2)).toBe('-3.2');
  });
});
