import { describe, it, expect } from 'vitest';
import { getPalette } from '../src/palettes';
import { parseState } from '../src/graph/state-parser';
import { layoutGraph } from '../src/graph/layout';
import { renderState } from '../src/graph/state-renderer';
import { parseC4 } from '../src/c4/parser';
import { layoutC4Containers } from '../src/c4/layout';
import { renderC4Containers } from '../src/c4/renderer';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { relayoutPert } from '../src/pert/layout';
import { renderPert } from '../src/pert/renderer';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';

/**
 * A tag value on a GROUP line must color that group's frame
 * (diagrammo/diagrammo#585).
 *
 * The convention is one recipe — `docs/architecture/diagram-visual-conventions.md`
 * §2 — and it was implemented in org, block, gantt, sequence and sketch while
 * boxes-and-lines, infra, kanban, c4 and pert drew the uncolored form over a
 * group the author had tagged. Two of them were worse than that: c4 rejected
 * the line outright, and state DESTROYED the group and orphaned its children.
 *
 * Every case here is a PAIR — the same diagram under two different group
 * values — because a single render proves only that some color came out, not
 * that it came from the group's own value. Three controls sit beside each pair:
 *
 * - an untagged group must stay NEUTRAL. This is the one that fails loudest if
 *   somebody drops the `isContainer` flag: the tag group below declares `Red`
 *   first, so `Red` is its default value, and a non-container resolution would
 *   paint every untagged frame in the diagram red.
 * - an UNKNOWN value must stay neutral too — `resolveTagColor` answers
 *   `UNTAGGED_TAG_COLOR` there, and that is a sentinel, not a paint value.
 * - c4's malformed tail must still DIAGNOSE, because the fix loosened what its
 *   group regex accepts.
 */
const P = getPalette('nord');
const TAGS = 'tag Concern as s\n  Red red\n  Blue blue\n';

/** Red / Blue as this palette resolves them — the values a tinted frame uses. */
const RED = '#bf616a';
const BLUE = '#5e81ac';

function box(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: 800, configurable: true });
  document.body.appendChild(c);
  return c as HTMLDivElement;
}

/** fill + stroke of the first frame matching `sel`. */
function frame(c: HTMLElement, sel: string): { fill: string; stroke: string } {
  const r = c.querySelector(sel);
  expect(r, `no frame matched ${sel}`).not.toBeNull();
  return {
    fill: r!.getAttribute('fill') ?? '',
    stroke: r!.getAttribute('stroke') ?? '',
  };
}

/**
 * The four assertions every chart owes: the two values differ from each other,
 * each carries its own color on the stroke, and neither control tints.
 */
function expectTintedPair(
  red: { fill: string; stroke: string },
  blue: { fill: string; stroke: string },
  bare: { fill: string; stroke: string },
  unknown: { fill: string; stroke: string }
): void {
  expect(red.stroke.toLowerCase()).toBe(RED);
  expect(blue.stroke.toLowerCase()).toBe(BLUE);
  expect(red.fill).not.toBe(blue.fill);
  // Untagged and unknown-valued groups keep the SAME neutral frame — the
  // container rule and the sentinel, checked together.
  expect(bare).toEqual(unknown);
  expect(bare.fill).not.toBe(red.fill);
  expect(bare.fill).not.toBe(blue.fill);
}

const VALUES = ['', ' s: Red', ' s: Blue', ' s: NoSuchValue'] as const;

describe('a tag value on a group line colors the frame (#585)', () => {
  describe('boxes-and-lines', () => {
    it('tints the frame, and keeps an untagged group neutral', async () => {
      const draw = async (tail: string) => {
        const src = `boxes-and-lines\n${TAGS}\n[Backend]${tail}\n  Api s: Blue\n  Db s: Blue\n`;
        const parsed = parseBoxesAndLines(src);
        const layout = await layoutBoxesAndLines(parsed);
        const c = box();
        renderBoxesAndLines(c, parsed, layout, P.light, false, {
          exportDims: { width: 800, height: 600 },
        });
        return frame(c, '.bl-group rect');
      };
      const [bare, red, blue, unknown] = await Promise.all(
        VALUES.map((v) => draw(v))
      );
      expectTintedPair(red!, blue!, bare!, unknown!);
    });

    it('keeps the color when the group is collapsed', async () => {
      const src = `boxes-and-lines\n${TAGS}\n[Backend] s: Red, collapsed\n  Api\n  Db\n`;
      const parsed = parseBoxesAndLines(src);
      const layout = await layoutBoxesAndLines(parsed);
      const c = box();
      renderBoxesAndLines(c, parsed, layout, P.light, false, {
        exportDims: { width: 800, height: 600 },
      });
      expect(frame(c, '.bl-group rect').stroke.toLowerCase()).toBe(RED);
    });
  });

  describe('infra', () => {
    const draw = (tail: string) => {
      const src = `infra\n${TAGS}\n[Backend]${tail}\n  API1\n  API2\n`;
      const parsed = parseInfra(src);
      const laid = layoutInfra(computeInfra(parsed), null);
      const c = box();
      renderInfra(
        c,
        laid,
        P.light,
        false,
        null,
        null,
        parsed.tagGroups,
        'Concern'
      );
      return frame(c, '.infra-group rect');
    };

    it('tints the frame, and keeps an untagged group neutral', () => {
      const [bare, red, blue, unknown] = VALUES.map((v) => draw(v));
      expectTintedPair(red!, blue!, bare!, unknown!);
    });

    it('resolves a group written with the tag ALIAS as well as the name', () => {
      // The alias→canonical pass walked `result.nodes` alone until 2026-08-30,
      // so a group authored `s: Red` kept the key `s` while every node was
      // rewritten to `concern` — and the frame matched nothing.
      const byAlias = draw(' s: Red');
      // 🔴 Assert the TINT, not merely that the two agree: unfixed, both come
      // back neutral and an equality-only check passes for the wrong reason.
      expect(byAlias.stroke.toLowerCase()).toBe(RED);
      expect(byAlias).toEqual(draw(' concern: Red'));
    });
  });

  describe('c4', () => {
    /** Boundaries sit on the element OR on one of its children, depending on
     *  which view the source declares; collect both. */
    const c4Groups = (parsed: ReturnType<typeof parseC4>) =>
      parsed.elements.flatMap((e) => [
        ...e.groups,
        ...e.children.flatMap((ch) => ch.groups),
      ]);
    const src = (tail: string) =>
      `c4 Grouped\n${TAGS}\nAnalytics is a system\n  containers\n    [Backend]${tail}\n      Api is a container\n      Worker is a container\n`;
    const draw = (tail: string) => {
      const parsed = parseC4(src(tail), P.light);
      const layout = layoutC4Containers(parsed, 'Analytics');
      const c = box();
      renderC4Containers(
        c,
        parsed,
        layout,
        P.light,
        false,
        undefined,
        {
          width: 1200,
          height: 800,
        },
        'Concern'
      );
      return frame(c, '.c4-group-boundary rect');
    };

    it('tints the boundary, and keeps an untagged one neutral', () => {
      const [bare, red, blue, unknown] = VALUES.map((v) => draw(v));
      expectTintedPair(red!, blue!, bare!, unknown!);
    });

    it('accepts the metadata tail instead of rejecting the whole line', () => {
      // Before the fix this was `Unexpected content: "[Backend] s: Red"` and
      // the entire diagram rendered as an error card.
      const parsed = parseC4(src(' s: Red'), P.light);
      expect(parsed.diagnostics).toEqual([]);
      expect(c4Groups(parsed).map((g) => g.name)).toContain('Backend');
    });

    it('still diagnoses a tail that is NOT metadata', () => {
      // The `$` anchor was load-bearing: loosening it must not swallow a
      // genuinely malformed boundary line.
      for (const tail of [' garbage tail', ' Red']) {
        const parsed = parseC4(src(tail), P.light);
        expect(
          parsed.diagnostics.map((d) => d.message).join('\n'),
          `expected a diagnostic for "[Backend]${tail}"`
        ).toContain('Unexpected content');
      }
    });

    it('leaves the collapse forms working', () => {
      for (const tail of [' collapsed', ' collapsed: true']) {
        const parsed = parseC4(src(tail), P.light);
        expect(parsed.diagnostics).toEqual([]);
        expect(c4Groups(parsed)[0]?.collapsed, `for "${tail}"`).toBe(true);
      }
    });
  });

  describe('state', () => {
    const src = (tail: string) =>
      `state\n${TAGS}\n[Backend]${tail}\n  Idle\n  Busy\n\nIdle -> Busy\n`;
    const draw = (tail: string) => {
      const parsed = parseState(src(tail));
      const layout = layoutGraph(parsed);
      const c = box();
      renderState(c, parsed, layout, P.light, false);
      return frame(c, '.st-group-wrapper rect');
    };

    it('tints the frame, and keeps an untagged group neutral', () => {
      const [bare, red, blue, unknown] = VALUES.map((v) => draw(v));
      expectTintedPair(red!, blue!, bare!, unknown!);
    });

    it('keeps the group and its members instead of destroying them', () => {
      // 🔴 The regression this test exists for. `GROUP_BRACKET_RE` is
      // `$`-anchored, so before the fix `[Backend] s: Red` fell through to the
      // state-node branch: the group vanished, `Idle` and `Busy` were
      // orphaned, and an ordinary state literally named `[Backend]` appeared
      // in its place. The only diagnostic was that the phantom state was not
      // connected to anything — which names neither the cause nor the line.
      const tagged = parseState(src(' s: Red'));
      const bare = parseState(src(''));

      expect(tagged.groups).toHaveLength(1);
      expect(tagged.groups![0]!.label).toBe('Backend');
      expect(tagged.groups![0]!.nodeIds).toEqual(bare.groups![0]!.nodeIds);
      expect(tagged.groups![0]!.metadata).toEqual({ concern: 'Red' });

      // No phantom state, and the same states as the untagged diagram.
      expect(tagged.nodes.map((n) => n.label)).toEqual(
        bare.nodes.map((n) => n.label)
      );
      expect(tagged.nodes.map((n) => n.label)).not.toContain('[Backend]');
    });
  });

  describe('pert', () => {
    const draw = (tail: string) => {
      const src = `pert\nactive-tag Concern\n${TAGS}\n[Backend]${tail}\n  Design 2 4 6\n  Build 3 5 9\n    after Design\n`;
      const parsed = parsePert(src);
      const layout = relayoutPert(analyzePert(parsed), {});
      const c = box();
      renderPert(c, analyzePert(parsed), layout, P.light, false, {
        title: parsed.title,
      });
      return frame(c, 'g.pert-group rect');
    };

    it('tints the frame, and keeps an untagged group neutral', () => {
      // The renderer carried the comment "PERT groups don't carry a color",
      // which was never true of the PARSER — `PertGroup.tags` has held the
      // value all along. Only this renderer never asked for it.
      const [bare, red, blue, unknown] = VALUES.map((v) => draw(v));
      expectTintedPair(red!, blue!, bare!, unknown!);
    });
  });

  describe('kanban', () => {
    const draw = (tail: string) => {
      const src = `kanban\n${TAGS}\n[Doing]${tail}\n  Card A\n  Card B\n`;
      const c = box();
      renderKanban(c, parseKanban(src), P.light, false, {
        activeTagGroup: 'Concern',
      });
      // The column HEADER band is the second rect in the column group: the
      // first is the column body.
      const rects = c.querySelectorAll('.kanban-column rect');
      const r = rects[1]!;
      return {
        fill: r.getAttribute('fill') ?? '',
        stroke: r.getAttribute('stroke') ?? '',
      };
    };

    it('colors the column header from the tag value', () => {
      const [bare, red, blue, unknown] = VALUES.map((v) => draw(v));
      expect(red!.fill).not.toBe(blue!.fill);
      expect(bare).toEqual(unknown);
      expect(bare!.fill).not.toBe(red!.fill);
    });

    it('leaves the §1.8 trailing color word working', () => {
      expect(draw(' green').fill).not.toBe(draw('').fill);
    });
  });
});
