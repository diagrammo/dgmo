// ============================================================
// Sequence Diagram Tag Resolution
// ============================================================
//
// Resolves effective tag values for participants and messages
// using the priority chain: explicit > group > receiver-inherit > default > neutral

import { tagAttrKey } from '../utils/tag-groups';
import type {
  ParsedSequenceDgmo,
  SequenceParticipant,
  SequenceMessage,
  SequenceGroup,
} from './parser';

/**
 * Resolved tag values for all sequence elements.
 * Used by the renderer to look up colors via tag group entries.
 */
export interface ResolvedTagMap {
  /** participantId → resolved tag value for the active group */
  participants: Map<string, string | undefined>;
  /** message lineNumber → tag value from explicit metadata */
  messages: Map<number, string | undefined>;
}

/**
 * Propagate group-level tag metadata to contained participants.
 * Only sets values for keys not already present on the participant.
 *
 * Mutates `participantMeta` in-place.
 */
export function propagateGroupTags(
  participantMeta: Map<string, Record<string, string>>,
  groups: ReadonlyArray<SequenceGroup>
): void {
  for (const group of groups) {
    if (!group.metadata) continue;
    for (const id of group.participantIds) {
      const meta = participantMeta.get(id);
      if (!meta) continue;
      for (const [key, value] of Object.entries(group.metadata)) {
        if (!(key in meta)) {
          meta[key] = value;
        }
      }
    }
  }
}

/**
 * Compute receiver inheritance for a specific tag group key.
 *
 * For each participant without an explicit value for `groupKey`,
 * collect values from all incoming tagged messages. If exactly one
 * unique value exists, the participant inherits it.
 *
 * Returns a map of participantId → inherited value.
 */
export function computeReceiverInheritance(
  participants: ReadonlyArray<SequenceParticipant>,
  messages: ReadonlyArray<SequenceMessage>,
  groupKey: string,
  participantMeta: Map<string, Record<string, string>>
): Map<string, string> {
  const inheritance = new Map<string, string>();

  for (const p of participants) {
    const meta = participantMeta.get(p.id);
    // Skip if already has a value for this group key
    if (meta?.[groupKey]) continue;

    const incomingValues = new Set<string>();
    for (const msg of messages) {
      if (msg.to === p.id && msg.metadata?.[groupKey]) {
        incomingValues.add(msg.metadata[groupKey]);
      }
    }

    if (incomingValues.size === 1) {
      // In-bounds: size === 1 guarantees [0] exists.
      inheritance.set(p.id, [...incomingValues][0]!);
    }
  }

  return inheritance;
}

/**
 * Full tag resolution for sequence diagrams.
 *
 * Priority: explicit metadata > group propagation > receiver inheritance > default > neutral
 *
 * Pure function — does not mutate `parsed`.
 */
export function resolveSequenceTags(
  parsed: ParsedSequenceDgmo,
  activeTagGroup: string
): ResolvedTagMap {
  const result: ResolvedTagMap = {
    participants: new Map(),
    messages: new Map(),
  };

  // Find the active tag group
  const group = parsed.tagGroups.find(
    (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
  );
  if (!group) {
    // No matching group — all neutral
    for (const p of parsed.participants) {
      result.participants.set(p.id, undefined);
    }
    for (const m of parsed.messages) {
      result.messages.set(m.lineNumber, undefined);
    }
    return result;
  }

  const groupKey = tagAttrKey(group.name);

  // Clone participant metadata (don't mutate parsed data)
  const participantMeta = new Map<string, Record<string, string>>();
  for (const p of parsed.participants) {
    participantMeta.set(p.id, { ...(p.metadata || {}) });
  }

  // Step 1: Group propagation
  propagateGroupTags(participantMeta, parsed.groups);

  // Step 2: Receiver inheritance
  const inherited = computeReceiverInheritance(
    parsed.participants,
    parsed.messages,
    groupKey,
    participantMeta
  );
  for (const [id, value] of inherited) {
    const meta = participantMeta.get(id)!;
    meta[groupKey] = value;
  }

  // Step 3: Default value injection
  if (group.defaultValue) {
    for (const p of parsed.participants) {
      const meta = participantMeta.get(p.id)!;
      if (!(groupKey in meta)) {
        meta[groupKey] = group.defaultValue;
      }
    }
  }

  // Build result maps
  for (const p of parsed.participants) {
    const meta = participantMeta.get(p.id)!;
    result.participants.set(p.id, meta[groupKey] || undefined);
  }

  for (const msg of parsed.messages) {
    result.messages.set(msg.lineNumber, msg.metadata?.[groupKey] || undefined);
  }

  return result;
}
