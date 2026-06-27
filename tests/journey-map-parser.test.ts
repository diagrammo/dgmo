import { describe, it, expect } from 'vitest';
import { parseJourneyMap } from '../src/journey-map/parser';

describe('journey-map parser', () => {
  // ── Chart type validation ─────────────────────────────────

  describe('chart type validation', () => {
    it('parses journey-map chart type', () => {
      const result = parseJourneyMap(
        'journey-map My Journey\n\n[Phase]\n  Step score: 3'
      );
      expect(result.type).toBe('journey-map');
      expect(result.title).toBe('My Journey');
      expect(result.error).toBeNull();
    });

    it('rejects wrong chart type', () => {
      const result = parseJourneyMap('kanban Board\n\n[Col]\n  Card');
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('Expected chart type "journey-map"');
    });

    it('errors on empty content', () => {
      const result = parseJourneyMap('');
      expect(result.error).toBeTruthy();
    });

    it('parses without title', () => {
      const result = parseJourneyMap('journey-map\n\n[Phase]\n  Step score: 3');
      expect(result.type).toBe('journey-map');
      expect(result.title).toBeUndefined();
      expect(result.error).toBeNull();
    });
  });

  // ── Persona parsing ───────────────────────────────────────

  describe('persona parsing', () => {
    it('parses persona name', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Tech Shopper\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Tech Shopper');
    });

    it('parses persona name + description', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Tech Shopper\n  28yo developer\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Tech Shopper');
      expect(result.persona?.description).toBe('28yo developer');
    });

    it('errors on bare persona keyword', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona\n\n[Phase]\n  Step score: 3'
      );
      expect(result.error).toContain('persona requires a name');
    });

    it('parses persona with same-line color (long form)', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Calico Jack color: red\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Calico Jack');
      expect(result.persona?.color).toBeTruthy();
    });

    it('parses persona with §1.5 trailing-token color', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Nadia green\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Nadia');
      expect(result.persona?.color).toBeTruthy();
    });

    it('keeps a capitalized trailing color word as literal name text', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Nadia Green\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Nadia Green');
      expect(result.persona?.color).toBeUndefined();
    });

    it('does not peel a non-trailing "color:" from the persona name', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\npersona Color Consultant\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona?.name).toBe('Color Consultant');
      expect(result.persona?.color).toBeUndefined();
    });

    it('works without persona', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 3'
      );
      expect(result.persona).toBeUndefined();
    });
  });

  // ── Tag blocks ────────────────────────────────────────────

  describe('tag blocks', () => {
    it('parses tag group with entries', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n  Mobile purple\n\n[Phase]\n  Step score: 3, ch: Web'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Channel');
      expect(result.tagGroups[0].alias).toBe('ch');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('resolves tag alias in step metadata', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n  Mobile purple\n\n[Phase]\n  Step score: 3, ch: Web'
      );
      const step = result.phases[0].steps[0];
      expect(step.tags).toHaveProperty('channel', 'Web');
    });
  });

  // ── Phase parsing ─────────────────────────────────────────

  describe('phase parsing', () => {
    it('parses single phase', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Research]\n  Step score: 4'
      );
      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].name).toBe('Research');
    });

    it('parses multiple phases', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Research]\n  Step A score: 4\n\n[Purchase]\n  Step B score: 2'
      );
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].name).toBe('Research');
      expect(result.phases[1].name).toBe('Purchase');
    });

    it('handles empty phase', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Empty]\n\n[Full]\n  Step score: 3'
      );
      expect(result.phases).toHaveLength(2);
      expect(result.phases[0].steps).toHaveLength(0);
      expect(result.phases[1].steps).toHaveLength(1);
    });
  });

  // ── Step parsing ──────────────────────────────────────────

  describe('step parsing', () => {
    it('parses step with score', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Walk in score: 4'
      );
      const step = result.phases[0].steps[0];
      expect(step.title).toBe('Walk in');
      expect(step.score).toBe(4);
      expect(step.emotionLabel).toBeUndefined();
    });

    it('parses step without score', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Check stock'
      );
      const step = result.phases[0].steps[0];
      expect(step.title).toBe('Check stock');
      expect(step.score).toBeUndefined();
    });

    it('parses step with score and emotion label', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Hit error score: 1, emotion: Frustrated'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBe(1);
      expect(step.emotionLabel).toBe('Frustrated');
    });

    it('parses step with score, label, and metadata', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n\n[Phase]\n  Hit error score: 1, emotion: Frustrated, ch: Web'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBe(1);
      expect(step.emotionLabel).toBe('Frustrated');
      expect(step.tags).toHaveProperty('channel', 'Web');
    });

    it('parses annotations on steps', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 2\n    pain: Too slow\n    opportunity: Speed up\n    thought: Hmm'
      );
      const step = result.phases[0].steps[0];
      expect(step.annotations).toHaveLength(3);
      expect(step.annotations[0]).toEqual({ type: 'pain', text: 'Too slow' });
      expect(step.annotations[1]).toEqual({
        type: 'opportunity',
        text: 'Speed up',
      });
      expect(step.annotations[2]).toEqual({ type: 'thought', text: 'Hmm' });
    });

    it('parses description on steps', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 3\n    description: More detail here'
      );
      const step = result.phases[0].steps[0];
      expect(step.description).toBe('More detail here');
    });

    it('handles step name containing number', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step 3 things score: 4'
      );
      const step = result.phases[0].steps[0];
      expect(step.title).toBe('Step 3 things');
      expect(step.score).toBe(4);
    });
  });

  // ── Score parsing edge cases ──────────────────────────────

  describe('score parsing edge cases', () => {
    it('score: 4 — bare score, no metadata', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 4'
      );
      expect(result.phases[0].steps[0].score).toBe(4);
    });

    it('score: 4, ch: Web — score + metadata', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n\n[Phase]\n  Step score: 4, ch: Web'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBe(4);
      expect(step.tags).toHaveProperty('channel', 'Web');
    });

    it('score: 4, emotion: Delighted — score + emotion label', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 4, emotion: Delighted'
      );
      expect(result.phases[0].steps[0].score).toBe(4);
      expect(result.phases[0].steps[0].emotionLabel).toBe('Delighted');
    });

    it('score + emotion + metadata', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n\n[Phase]\n  Step score: 4, emotion: Delighted, ch: Web'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBe(4);
      expect(step.emotionLabel).toBe('Delighted');
      expect(step.tags).toHaveProperty('channel', 'Web');
    });

    it('emotion: Very Happy — multi-word label warns but preserves score', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 4, emotion: Very Happy'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBe(4); // score is preserved
      expect(step.emotionLabel).toBeUndefined(); // label is dropped
      const diag = result.diagnostics.find((d) =>
        d.message.includes('single word')
      );
      expect(diag).toBeTruthy();
    });

    it('ch: Web — no score produces diagnostic hint', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n\n[Phase]\n  Step ch: Web'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBeUndefined();
      const hint = result.diagnostics.find((d) =>
        d.message.includes('no score')
      );
      expect(hint).toBeTruthy();
    });

    it('score: 0 — out of range', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 0'
      );
      const diag = result.diagnostics.find((d) =>
        d.message.includes('out of range')
      );
      expect(diag).toBeTruthy();
    });

    it('score: 6 — out of range', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 6'
      );
      const diag = result.diagnostics.find((d) =>
        d.message.includes('out of range')
      );
      expect(diag).toBeTruthy();
    });

    it('score: 4.5 — float rejected', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: 4.5'
      );
      const diag = result.diagnostics.find((d) =>
        d.message.includes('integer 1-5')
      );
      expect(diag).toBeTruthy();
    });

    it('score: -1 — negative rejected (out of range)', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: -1'
      );
      const step = result.phases[0].steps[0];
      expect(step.score).toBeUndefined();
    });

    it('score: banana — invalid explicit score', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[Phase]\n  Step score: banana'
      );
      const diag = result.diagnostics.find((d) =>
        d.message.includes('integer 1-5')
      );
      expect(diag).toBeTruthy();
    });
  });

  // ── Flat mode ─────────────────────────────────────────────

  describe('flat mode', () => {
    it('parses steps without phases', () => {
      const result = parseJourneyMap(
        'journey-map Quick Feedback\n\nOpened app score: 4\nSearched score: 3\nHit error score: 1'
      );
      expect(result.phases).toHaveLength(0);
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].title).toBe('Opened app');
      expect(result.steps[0].score).toBe(4);
    });

    it('flat mode with annotations', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\nHit error score: 1, emotion: Frustrated\n  pain: No help message'
      );
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].annotations).toHaveLength(1);
      expect(result.steps[0].annotations[0].type).toBe('pain');
    });
  });

  // ── Options ───────────────────────────────────────────────

  describe('options', () => {
    it('warns on removed no-legend option', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\nno-legend\n\n[Phase]\n  Step score: 3'
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'warning' &&
            d.message.includes('"no-legend" has been removed')
        )
      ).toBe(true);
    });

    it('parses active-tag option', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n\nactive-tag Channel\n\n[Phase]\n  Step score: 3'
      );
      expect(result.options['active-tag']).toBe('Channel');
    });
  });

  // ── Tag validation ─────────────────────────────────────────

  describe('tag validation', () => {
    it('warns on unknown tag value', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n  Mobile purple\n\n[Phase]\n  Step score: 3, ch: Desktop'
      );
      const warning = result.diagnostics.find((d) =>
        d.message.includes('Unknown tag value')
      );
      expect(warning).toBeTruthy();
    });

    it('no warning for valid tag value', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\ntag Channel as ch\n  Web blue\n  Mobile purple\n\n[Phase]\n  Step score: 3, ch: Web'
      );
      const warning = result.diagnostics.find((d) =>
        d.message.includes('Unknown tag value')
      );
      expect(warning).toBeUndefined();
    });
  });

  // ── Mixed mode ────────────────────────────────────────────

  describe('mixed mode', () => {
    it('warns on stray lines between phases', () => {
      const result = parseJourneyMap(
        'journey-map Test\n\n[A]\n  Step A score: 3\n\nLoose step score: 3\n\n[B]\n  Step B score: 4'
      );
      const warning = result.diagnostics.find((d) =>
        d.message.includes('outside any phase')
      );
      expect(warning).toBeTruthy();
    });
  });

  // ── Full integration ──────────────────────────────────────

  describe('full integration', () => {
    it('parses the Buying a Laptop example', () => {
      const content = `journey-map Buying a Laptop

persona Tech-Savvy Shopper
  28yo developer, price-sensitive, does extensive research

tag Channel as ch
  Web blue
  Mobile purple
  Email teal
  In-Person green

[Research]
  Compare specs score: 4, ch: Web
    description: Checked 12 laptops across 4 review sites
  Watch reviews score: 5, emotion: Engaged, ch: Mobile
  Ask friends score: 4, ch: In-Person

[Purchase]
  Add to cart score: 3, ch: Web
  Forced account creation score: 1, emotion: Frustrated, ch: Web
    pain: Wants guest checkout
    pain: Password requirements too strict
  Complete payment score: 3, ch: Web

[Delivery]
  Track package score: 4, ch: Mobile
  Unboxing score: 5, emotion: Delighted, ch: In-Person
    opportunity: Include setup guide
    thought: Excited to try it out`;

      const result = parseJourneyMap(content);

      expect(result.error).toBeNull();
      expect(result.title).toBe('Buying a Laptop');
      expect(result.persona?.name).toBe('Tech-Savvy Shopper');
      expect(result.phases).toHaveLength(3);
      expect(result.phases[0].name).toBe('Research');
      expect(result.phases[1].name).toBe('Purchase');
      expect(result.phases[2].name).toBe('Delivery');

      // Total steps
      const totalSteps = result.phases.reduce((s, p) => s + p.steps.length, 0);
      expect(totalSteps).toBe(8);

      // Check specific step
      const forced = result.phases[1].steps[1];
      expect(forced.title).toBe('Forced account creation');
      expect(forced.score).toBe(1);
      expect(forced.emotionLabel).toBe('Frustrated');
      expect(forced.annotations).toHaveLength(2);
      expect(forced.annotations[0].type).toBe('pain');

      // Check unboxing
      const unboxing = result.phases[2].steps[1];
      expect(unboxing.title).toBe('Unboxing');
      expect(unboxing.score).toBe(5);
      expect(unboxing.emotionLabel).toBe('Delighted');
      expect(unboxing.annotations).toHaveLength(2);

      // Tag groups
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Channel');
      expect(result.tagGroups[0].entries).toHaveLength(4);
    });
  });
});
