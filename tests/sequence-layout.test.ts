// @vitest-environment node
// No DOM here on purpose: `layoutSequence` must lay a diagram out with no
// document, no container and no SVG, so a layout bug is a coordinate assertion.
import { describe, it, expect } from 'vitest';
import { parseSequenceDgmo } from '../src/sequence/parser';
import type { SequenceSection } from '../src/sequence/parser';
import { layoutSequence } from '../src/sequence/renderer';
import type { SequenceRenderOptions } from '../src/sequence/renderer';

const WIDTH = 1200;

function layout(source: string, options?: SequenceRenderOptions) {
  const result = layoutSequence(parseSequenceDgmo(source), WIDTH, options);
  if (!result) throw new Error('nothing laid out');
  return result;
}

/** Y of the first drawn step of the message on `lineNumber`. */
function messageY(laid: ReturnType<typeof layout>, lineNumber: number): number {
  const mi = laid.messages.findIndex((m) => m.lineNumber === lineNumber);
  const si = laid.msgToFirstStep.get(mi);
  if (si === undefined) throw new Error(`line ${lineNumber} not drawn`);
  return laid.stepYPositions[si]!;
}

describe('layoutSequence', () => {
  it('lays out with no DOM and returns no layout for no participants', () => {
    expect(typeof globalThis.document).toBe('undefined');
    expect(layoutSequence(parseSequenceDgmo('sequence'), WIDTH)).toBeNull();
  });

  it('places columns left to right and steps top to bottom', () => {
    const laid = layout(['A -one-> B', 'B -two-> C'].join('\n'));
    const xs = laid.participants.map((p) => laid.participantX.get(p.id)!);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
    expect(laid.stepYPositions[1]! - laid.stepYPositions[0]!).toBe(35);
    expect(laid.stepLabels).toEqual(['one', 'two']);
    expect(laid.svgWidth).toBeGreaterThanOrEqual(WIDTH);
  });

  // The same regression as `an expanded section below collapsed ones` in
  // sequence-collapse.test.ts (#899), asserted on coordinates instead of SVG:
  // a collapsed section's notes reserved room that landed on the first
  // message of the next expanded section.
  describe('a section below collapsed sections (#899)', () => {
    const diagram = [
      'sequence Checkout',
      '',
      '== Browse ==',
      '',
      'Fan -Find games-> Agent',
      'note right of Agent',
      '  A note tall enough to matter:',
      '  it runs to three lines',
      '  and reserves room below its message.',
      'Agent -List games-> Fan',
      '',
      '== Pay ==',
      '',
      'if card needs step-up',
      '  Agent -Challenge-> Fan',
      '  note right of Agent',
      '    A note that ends the block.',
      'else',
      '  Agent -Approve-> Fan',
      'note right of Agent',
      '  One more note in the folded part.',
      'Fan -Confirm-> Agent',
      '',
      '== After purchase ==',
      '',
      'Agent -Send tickets-> Fan',
      'Fan -Say thanks-> Agent',
    ].join('\n');
    const parsed = parseSequenceDgmo(diagram);
    const sectionLine = (label: string): number =>
      parsed.elements
        .filter((el): el is SequenceSection => el.kind === 'section')
        .find((s) => s.label === label)!.lineNumber;
    const after = sectionLine('After purchase');
    const firstAfter = parsed.messages.find((m) => m.lineNumber > after)!;

    const gapUnderAfterPurchase = (collapsed: number[]): number => {
      const laid = layout(diagram, { collapsedSections: new Set(collapsed) });
      return (
        messageY(laid, firstAfter.lineNumber) -
        laid.sectionYPositions.get(after)!
      );
    };

    it('opens with the same gap as when nothing is collapsed', () => {
      expect(
        gapUnderAfterPurchase([sectionLine('Browse'), sectionLine('Pay')])
      ).toBeCloseTo(gapUnderAfterPurchase([]), 6);
    });

    it('lays out no folded note', () => {
      const laid = layout(diagram, {
        collapsedSections: new Set([sectionLine('Browse'), sectionLine('Pay')]),
      });
      expect(laid.noteLayouts.size).toBe(0);
      expect(layout(diagram).noteLayouts.size).toBe(3);
    });
  });

  // The same regression as `activation bars and message labels` in
  // sequence-activation-clearance.test.ts (#972): a label crossing the end of
  // an unreturned bar gets room before its row, and the bar's end stays put.
  describe('a label crossing an unreturned bar (#972)', () => {
    const reported = [
      'sequence How TM Does Biometric Entry',
      'App',
      'Kiosk',
      'Service',
      'BiometricDB',
      'TicketInventory',
      '',
      '== Registration ==',
      'Fan -register face-> App',
      'App -store-> Service',
      'Service -store-> BiometricDB',
      '',
      '== Ingress ==',
      'Kiosk -scan face-> Fan',
      'Kiosk -check it-> Service',
      'Service -get id from face-> BiometricDB',
    ].join('\n');
    const unlabeled = reported.replace(
      'Kiosk -scan face-> Fan',
      'Kiosk -> Fan'
    );
    const crossingLine = 14;

    it('moves the crossing row down by exactly the room it was given', () => {
      const before = layout(unlabeled);
      const after = layout(reported);
      const mi = after.messages.findIndex((m) => m.lineNumber === crossingLine);
      const si = after.msgToFirstStep.get(mi)!;
      expect(before.labelRoomBefore[si]).toBe(0);
      expect(after.labelRoomBefore[si]).toBeGreaterThan(0);
      expect(
        messageY(after, crossingLine) - messageY(before, crossingLine)
      ).toBeCloseTo(after.labelRoomBefore[si]!, 6);
    });

    it('adds no room when no label crosses an unreturned bar', () => {
      const laid = layout(
        ['A -call-> B', 'B -next-> C', 'A -back-> B'].join('\n')
      );
      expect(laid.labelRoomBefore.every((room) => room === 0)).toBe(true);
    });
  });
});
