import { describe, it, expect } from 'vitest';
import {
  applyGroupOrdering,
  applyPositionOverrides,
} from '../src/sequence/renderer';
import type {
  SequenceParticipant,
  SequenceMessage,
  SequenceGroup,
} from '../src/sequence/parser';

// ============================================================
// Helper factories
// ============================================================

function p(id: string, position?: number): SequenceParticipant {
  return { id, label: id, type: 'default', lineNumber: 1, position };
}

function m(from: string, to: string): SequenceMessage {
  return { kind: 'message', from, to, label: 'msg', lineNumber: 1 };
}

function g(name: string, participantIds: string[]): SequenceGroup {
  return { name, participantIds, lineNumber: 1 };
}

/**
 * Mirror the renderer's composition (renderer.ts):
 *   applyPositionOverrides(applyGroupOrdering(participants, groups, messages))
 * and return the resulting left-to-right id order.
 *
 * Like the parser, any message-referenced id that wasn't explicitly declared is
 * registered as a participant (appended in first-appearance order), so callers
 * only need to declare the exceptions they care about.
 */
function order(
  participants: SequenceParticipant[],
  messages: SequenceMessage[] = [],
  groups: SequenceGroup[] = []
): string[] {
  const registered = [...participants];
  const known = new Set(registered.map((x) => x.id));
  for (const msg of messages) {
    for (const id of [msg.from, msg.to]) {
      if (!known.has(id)) {
        known.add(id);
        registered.push(p(id));
      }
    }
  }
  return applyPositionOverrides(
    applyGroupOrdering(registered, groups, messages)
  ).map((x) => x.id);
}

// ============================================================
// Participant ordering — the priority ladder (spec §2.2)
// ============================================================

describe('sequence participant ordering', () => {
  // Priority 3: first appearance in messages is the default, even with no
  // spatial groups. This is the core fix — declaration order no longer pins
  // a column for participants that appear in messages.
  it('orders by first message appearance, not declaration order', () => {
    // Checkout shape: only the exceptions (User, Stripe) are declared, and
    // Stripe is declared second — but it first appears mid-flow.
    const participants = [p('User'), p('Stripe')];
    const messages = [
      m('User', 'WebApp'),
      m('WebApp', 'API'),
      m('API', 'Stripe'),
      m('Stripe', 'API'),
      m('API', 'DB'),
    ];
    // Declaration order would give: User, Stripe, WebApp, API, DB (crossing).
    expect(order(participants, messages)).toEqual([
      'User',
      'WebApp',
      'API',
      'Stripe',
      'DB',
    ]);
  });

  it('places a declared participant by appearance, ignoring declaration index', () => {
    // Declared A, B, C but arrows flow A -> C -> B.
    const participants = [p('A'), p('B'), p('C')];
    const messages = [m('A', 'C'), m('C', 'B'), m('B', 'A')];
    expect(order(participants, messages)).toEqual(['A', 'C', 'B']);
  });

  // Priority 4: declaration order is the tiebreaker ONLY for participants that
  // never appear in a message. They are appended after the referenced ones.
  it('appends message-absent participants in declaration order', () => {
    const participants = [p('Audit'), p('Legend')];
    const messages = [m('User', 'WebApp'), m('WebApp', 'API')];
    expect(order(participants, messages)).toEqual([
      'User',
      'WebApp',
      'API',
      'Audit',
      'Legend',
    ]);
  });

  // Regression guard: a declaration-only diagram (no messages) must preserve
  // declaration order exactly — nothing to reorder by.
  it('preserves declaration order when there are no messages', () => {
    const participants = [p('C'), p('A'), p('B')];
    expect(order(participants, [])).toEqual(['C', 'A', 'B']);
  });

  // Priority 1: explicit position wins over appearance order.
  it('lets explicit position: override appearance order', () => {
    const participants = [p('User'), p('Stripe', -1)]; // Stripe pinned rightmost
    const messages = [
      m('User', 'WebApp'),
      m('WebApp', 'API'),
      m('API', 'Stripe'),
      m('API', 'DB'),
    ];
    expect(order(participants, messages)).toEqual([
      'User',
      'WebApp',
      'API',
      'DB',
      'Stripe',
    ]);
  });

  // Priority 2: spatial group adjacency outranks each member's own appearance
  // slot — DB is pulled up next to API, ahead of Stripe.
  it('pulls group members adjacent at the group anchor', () => {
    const participants = [p('User'), p('Stripe'), p('API'), p('DB')];
    const groups = [g('Backend', ['API', 'DB'])];
    const messages = [
      m('User', 'WebApp'),
      m('WebApp', 'API'),
      m('API', 'Stripe'),
      m('API', 'DB'),
    ];
    expect(order(participants, messages, groups)).toEqual([
      'User',
      'WebApp',
      'API',
      'DB',
      'Stripe',
    ]);
  });
});
