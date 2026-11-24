// ============================================================
// Venn diagnostic catalog (#1992)
// ============================================================
//
// The coded diagnostics of venn's `size:` values and `proportional` flag.
// Every message builder tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const VENN_DX = {
  SIZE_MISSING: {
    code: 'W_VENN_SIZE_MISSING',
    severity: 'warning',
    chartType: 'venn',
    title: 'Proportional line has no size',
    message: (p) =>
      `'${(p.name as string) ?? 'This line'}' has no \`size:\`, so ${p.overlap ? 'the overlap is drawn at the default depth' : 'the circle is drawn at the average size'}.`,
    hint: 'Under `proportional`, give every set and overlap line a count: `Frontend as fe blue size: 40`, `fe + be Web Systems size: 12`.',
    example: `venn Skills\nproportional\n\nFrontend as fe blue size: 40\nBackend as be green\n\nfe + be Web Systems size: 12`,
  },
  SIZE_INVALID: {
    code: 'W_VENN_SIZE_INVALID',
    severity: 'warning',
    chartType: 'venn',
    title: 'Size is not a count',
    message: (p) =>
      `\`size: ${(p.value as string) ?? ''}\` is not ${p.overlap ? 'zero or a positive number' : 'a positive number'}, so it is ignored.`,
    hint: 'Write a plain number: `size: 40`. A set needs more than 0; an overlap may be 0.',
    example: `venn Skills\nproportional\n\nFrontend as fe blue size: forty\nBackend as be green size: 30`,
  },
  SIZE_TOO_LARGE: {
    code: 'W_VENN_SIZE_TOO_LARGE',
    severity: 'warning',
    chartType: 'venn',
    title: 'Overlap is larger than its set',
    message: (p) =>
      `The overlap's size ${(p.size as number) ?? ''} is larger than '${(p.name as string) ?? 'a member'}' (${(p.limit as number) ?? ''}), so it is drawn at that size.`,
    hint: 'An overlap counts items in every listed set, so it cannot be larger than the smallest of them — or than any overlap of fewer of those sets.',
    example: `venn Skills\nproportional\n\nFrontend as fe blue size: 10\nBackend as be green size: 30\n\nfe + be Web Systems size: 12`,
  },
  SIZE_UNUSED: {
    code: 'W_VENN_SIZE_UNUSED',
    severity: 'warning',
    chartType: 'venn',
    title: 'Sizes need proportional',
    message: () =>
      '`size:` is drawn only under `proportional`, so the circles stay equal.',
    hint: 'Add a `proportional` line to draw each circle and overlap at its size, or remove the `size:` values.',
    example: `venn Skills\n\nFrontend as fe blue size: 40\nBackend as be green size: 30`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const VENN_DIAGNOSTICS: DiagnosticSpec[] = Object.values(VENN_DX);
