import { describe, it, expect, vi } from 'vitest';
// Import from the palettes barrel so every palette module self-registers.
import { resolvePaletteOrFallback } from '../src/palettes';

// Story 110.2: the "resolve · fall back · warn" policy now lives in one place.
// These pin the policy without a host (AC4).

describe('resolvePaletteOrFallback', () => {
  it('returns the requested palette when the id is registered', () => {
    const warn = vi.fn();
    const result = resolvePaletteOrFallback('nord', warn);
    expect(result.id).toBe('nord');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default palette (slate) on an unknown id and warns', () => {
    const warn = vi.fn();
    const result = resolvePaletteOrFallback('does-not-exist', warn);
    expect(result.id).toBe('slate');
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain('does-not-exist');
    expect(message).toContain('slate');
  });

  it('is silent (no throw, no warn) when no logger is passed', () => {
    const result = resolvePaletteOrFallback('still-not-real');
    expect(result.id).toBe('slate');
  });

  it('does not warn when the requested id resolves, even with a logger', () => {
    const warn = vi.fn();
    resolvePaletteOrFallback('slate', warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
