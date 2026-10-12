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

  describe('frames', () => {
    const nested = [
      'sequence',
      'Client',
      '',
      '[Outer]',
      '  A',
      '  [Inner]',
      '    B',
      '    C',
      '  D',
      '',
      'Server',
      'Client -go-> A',
      'A -on-> B',
      'B -next-> C',
      'C -back-> D',
      'D -done-> Server',
    ].join('\n');

    const frameOf = (laid: ReturnType<typeof layout>, name: string) => {
      const frame = laid.groupFrames.find((f) => f.group.name === name);
      if (!frame) throw new Error(`no frame for ${name}`);
      return frame;
    };

    it('lays the outer group frame out first and the inner one inside it', () => {
      const laid = layout(nested);
      expect(laid.groupFrames.map((f) => f.group.name)).toEqual([
        'Outer',
        'Inner',
      ]);
      const outer = frameOf(laid, 'Outer');
      const inner = frameOf(laid, 'Inner');
      expect(inner.x).toBeGreaterThan(outer.x);
      expect(inner.x + inner.width).toBeLessThan(outer.x + outer.width);
      expect(inner.y).toBeGreaterThan(outer.y);
      // A nested frame's floor clears its parent's by one inset (6).
      expect(outer.y + outer.height - (inner.y + inner.height)).toBe(6);
      // The header strip is everything above the member boxes.
      expect(inner.y + inner.headerHeight).toBe(laid.participantStartY);
    });

    it('bisects the gap to the column on either side of a nested group', () => {
      const laid = layout(nested);
      const x = (id: string) => laid.participantX.get(id)!;
      const inner = frameOf(laid, 'Inner');
      expect(inner.x).toBeCloseTo((x('A') + x('B')) / 2, 6);
      expect(inner.x + inner.width).toBeCloseTo((x('C') + x('D')) / 2, 6);
    });

    it('sizes a collapsed group to the expanded frame beside it (#447)', () => {
      const parsed = parseSequenceDgmo(nested);
      const innerLine = parsed.groups.find((g) => g.name === 'Inner')!;
      const laid = layout(nested, {
        collapsedGroups: new Set([innerLine.lineNumber]),
      });
      const outer = frameOf(laid, 'Outer');
      const box = laid.collapsedGroupBoxes.get('Inner')!;
      // It stands where its own frame would have: one strip below the outer
      // frame's top, one inset above the outer frame's floor.
      expect(laid.participantStartY - box.padTop).toBe(
        outer.y + 22 // GROUP_PADDING_TOP
      );
      expect(box.padBottom).toBe(8); // GROUP_PADDING_BOTTOM at the deepest level
      // Its lifeline starts under the taller box, not under an ordinary one.
      expect(laid.lifelines.get('Inner')![0]![0]).toBe(
        laid.lifelineStartY0 + box.padBottom
      );
      expect(laid.lifelines.get('Client')![0]![0]).toBe(laid.lifelineStartY0);
    });

    it('takes an ordinary height when no group is left expanded (#447)', () => {
      const parsed = parseSequenceDgmo(nested);
      const laid = layout(nested, {
        collapsedGroups: new Set(parsed.groups.map((g) => g.lineNumber)),
      });
      expect(laid.groupFrames).toEqual([]);
      expect(laid.collapsedGroupBoxes.get('Outer')).toMatchObject({
        padTop: 0,
        padBottom: 0,
      });
    });

    describe('block frames', () => {
      const blocks = [
        'sequence',
        'A',
        'B',
        'C',
        'if first',
        '  A -one-> B',
        'else if second',
        '  B -two-> C',
        '  loop again',
        '    C -three-> B',
        'else',
        '  A -four-> C',
        '  C -self-> C',
      ].join('\n');

      it('lays out a parent before its child, with a divider per branch', () => {
        const laid = layout(blocks);
        expect(laid.blockFrames.map((f) => f.label.text)).toEqual([
          'if first',
          'loop again',
        ]);
        const [outer, loop] = laid.blockFrames;
        expect(outer!.dividers.map((d) => d.label.text)).toEqual([
          'else if second',
          'else',
        ]);
        // Each divider sits one block header above its branch's first message.
        expect(outer!.dividers[0]!.y).toBe(messageY(laid, 8) - 30);
        expect(outer!.dividers[1]!.y).toBe(messageY(laid, 12) - 30);
        expect(outer!.dividers.map((d) => d.lineNumber)).toEqual([7, 11]);
        // The loop sits inside the frame around it.
        expect(loop!.y).toBeGreaterThan(outer!.y);
        expect(loop!.y + loop!.height).toBeLessThan(outer!.y + outer!.height);
      });

      it('grows a frame whose last step is a self-call to hold its loop', () => {
        const laid = layout(blocks);
        const outer = laid.blockFrames[0]!;
        const x = (id: string) => laid.participantX.get(id)!;
        // Taller by the self-call's loop below the last step…
        expect(outer.y + outer.height).toBe(
          messageY(laid, 13) + 15 + laid.sSelfCallHeight
        );
        // …and wider on the loop's side, so the loop clears the border by 10.
        expect(outer.x + outer.width).toBeCloseTo(
          x('C') + laid.sActivationWidth / 2 + laid.sSelfCallWidth + 10,
          6
        );
      });
    });

    it("cuts a section's label out of the lifeline under it", () => {
      const laid = layout(
        [
          'sequence',
          'A',
          'B',
          'C',
          'A -one-> B',
          'B -on-> C',
          '== Phase ==',
          'C -two-> A',
        ].join('\n')
      );
      const band = laid.sectionBands[0]!;
      expect(band.labelText).toBe('Phase');
      expect(band.y).toBe(laid.sectionYPositions.get(7));
      // The label is centred across the band, over B's lifeline, which runs
      // in two pieces around it; A's and C's run unbroken.
      expect(band.labelX).toBeCloseTo(laid.participantX.get('B')!, 6);
      const [above, below] = laid.lifelines.get('B')!;
      expect(above![1]).toBe(band.labelBaseline - 12);
      expect(below![0]).toBe(band.labelBaseline + 5);
      expect(laid.lifelines.get('A')).toHaveLength(1);
      expect(laid.lifelines.get('C')).toHaveLength(1);
    });
  });

  describe('marks', () => {
    const source = [
      'sequence Marks',
      'A',
      'B',
      'C',
      'A -call-> B',
      'note right of B',
      '  - a bullet long enough to wrap onto a second line of the note',
      '  - second',
      'B -self-> B',
      'note right of B',
      '  after the self-call',
      'B -ask-> C',
      'C -tell-> A',
    ].join('\n');
    const laid = layout(source);
    const x = (id: string) => laid.participantX.get(id)!;
    const stepOf = (line: number) =>
      laid.msgToFirstStep.get(
        laid.messages.findIndex((m) => m.lineNumber === line)
      )!;

    it('ends every arrow on the edge of the bar it meets', () => {
      const call = laid.messageArrows[stepOf(5)]!;
      expect(call.kind).toBe('call');
      if (call.kind === 'self') throw new Error('not a self-call');
      const barOnB = laid.activations.findIndex(
        (a) => a.participantId === 'B' && a.startStep === stepOf(5)
      );
      const bar = laid.activationBars[barOnB]!;
      expect(call.x1).toBe(x('A'));
      expect(call.x2).toBe(bar.x);
      expect(call.label.x).toBe((call.x1 + call.x2) / 2);
      expect(call.label.y).toBeLessThan(call.y);
    });

    it("loops a self-call out of its bar's right edge and draws its return with it", () => {
      const si = stepOf(9);
      const loop = laid.messageArrows[si]!;
      if (loop.kind !== 'self') throw new Error('not a self-call');
      // The deepest bar open on B at that step is the one it leaves.
      const open = laid.activations
        .map((a, k) => ({ a, bar: laid.activationBars[k]! }))
        .filter(
          ({ a }) =>
            a.participantId === 'B' && a.startStep <= si && si <= a.endStep
        )
        .sort((p, q) => q.a.depth - p.a.depth)[0]!;
      expect(loop.x).toBeCloseTo(open.bar.x + open.bar.width, 9);
      expect(loop.loopX - loop.x).toBe(laid.sSelfCallWidth);
      expect(loop.returnY - loop.y).toBe(laid.sSelfCallHeight);
      expect(loop.label.x).toBeGreaterThan(loop.loopX);
      // Its return is the loop's lower leg, never an arrow of its own.
      const ret = laid.renderSteps.findIndex(
        (s, i) =>
          i > si && s.type === 'return' && s.from === 'B' && s.to === 'B'
      );
      if (ret >= 0) expect(laid.messageArrows[ret]).toBeNull();
    });

    it('hangs a note beside its lifeline, past a self-call loop when it follows one', () => {
      const [first, second] = [...laid.noteBoxes.values()];
      expect(first!.x).toBe(x('B') + laid.sActivationWidth + laid.sNoteGap);
      const loop = laid.messageArrows[stepOf(9)]!;
      if (loop.kind !== 'self') throw new Error('not a self-call');
      expect(second!.x).toBeGreaterThan(loop.loopX);
      for (const box of [first!, second!]) {
        expect(box.height).toBe(
          box.lines.length * laid.sNoteLineH + laid.sNotePadV * 2
        );
      }
    });

    it("sets a bullet's glyph at the left and its body, wrapped lines too, one indent in", () => {
      const [first] = [...laid.noteBoxes.values()];
      const lines = first!.lines;
      // The first bullet wraps; the second does not.
      expect(lines[0]!.kind).toBe('bullet-first');
      expect(lines[1]!.kind).toBe('bullet-cont');
      expect(lines.at(-1)!.kind).toBe('bullet-first');
      expect(lines[0]!.bulletX).toBe(first!.x + laid.sNotePadH);
      for (const line of lines) {
        expect(line.bulletX === undefined).toBe(line.kind !== 'bullet-first');
      }
      for (const line of lines)
        expect(line.x).toBe(first!.x + laid.sNotePadH + 10);
      expect(lines[1]!.y - lines[0]!.y).toBe(laid.sNoteLineH);
    });

    it("stops an unreturned bar short of the next row, and its label's room (#972)", () => {
      const reported = [
        'A',
        'B',
        'C',
        'A -call-> B',
        'C -crossing label-> A',
      ].join('\n');
      const l = layout(reported);
      const ai = l.activations.findIndex((a) => a.implicitEnd);
      expect(ai).toBeGreaterThanOrEqual(0);
      const act = l.activations[ai]!;
      const bar = l.activationBars[ai]!;
      expect(bar.y + bar.height).toBe(
        // ACTIVATION_IMPLICIT_END_CLEARANCE is 8.
        l.stepYPositions[act.endStep]! - l.labelRoomBefore[act.endStep]! - 8
      );
    });

    it('sizes a collapsed group box around its name and collapse bar', () => {
      const l = layout(['[G]', '  A', '  B', 'C', 'A -1-> C'].join('\n'), {
        collapsedGroups: new Set([1]),
      });
      const box = l.collapsedGroupBoxes.get('G')!;
      expect(box.height).toBe(l.sBoxH + box.padTop + box.padBottom);
      expect(box.barY + box.barHeight).toBe(-box.padTop + box.height);
      expect(box.nameY).toBe(-box.padTop + (box.height - box.barHeight) / 2);
    });

    it("marks every column on a collapsed section, and the fold's reach", () => {
      const src = [
        'A',
        'B',
        'C',
        'D',
        '== Fold ==',
        'B -1-> C',
        'C -2-> C',
      ].join('\n');
      const l = layout(src, { collapsedSections: new Set([5]) });
      const band = l.sectionBands[0]!;
      expect(band.collapsed).toBe(true);
      // One per column, in column order, whether or not it took part.
      expect(band.marks.map((m) => m.participantId)).toEqual(
        l.participants.map((p) => p.id)
      );
      const mark = (id: string) =>
        band.marks.find((m) => m.participantId === id)!;
      const [a, b, c] = ['A', 'B', 'C'].map(mark);
      expect(band.marks.map((m) => m.participantId).sort()).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
      expect(a!.part).toBeUndefined();
      expect(a!.radius).toBe(2.5);
      expect(b!.part!.sends).toBe(1);
      expect(c!.radius).toBeGreaterThan(b!.radius);
      expect(band.reach).toEqual({
        x1: l.participantX.get('B'),
        x2: l.participantX.get('C'),
      });
      expect(layout(src).sectionBands[0]!.marks).toEqual([]);
    });
  });
});
