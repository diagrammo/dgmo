// ============================================================
// Collapse Projection for Sequence Diagram Groups
// ============================================================
//
// Pure projection function that transforms a parsed sequence diagram
// by collapsing specified groups into single virtual participants.
// The parsed AST (ParsedSequenceDgmo) stays immutable.

import type {
  ParsedSequenceDgmo,
  ParticipantId,
  SequenceElement,
  SequenceGroup,
  SequenceMessage,
  SequenceParticipant,
} from './parser';
import { isSequenceBlock, isSequenceNote, isSequenceSection } from './parser';

export interface CollapsedView {
  participants: readonly SequenceParticipant[];
  messages: readonly SequenceMessage[];
  elements: readonly SequenceElement[];
  groups: readonly SequenceGroup[];
  /** Maps member participant ID → collapsed group name (as a virtual ParticipantId). */
  collapsedGroupIds: Map<ParticipantId, ParticipantId>;
}

/**
 * Project a parsed sequence diagram into a collapsed view.
 *
 * @param parsed - The immutable parsed sequence diagram
 * @param collapsedGroups - Set of group lineNumbers that should be collapsed
 * @returns A new CollapsedView with remapped participants, messages, elements, and groups
 */
export function applyCollapseProjection(
  parsed: ParsedSequenceDgmo,
  collapsedGroups: Set<number>
): CollapsedView {
  if (collapsedGroups.size === 0) {
    return {
      participants: parsed.participants,
      messages: parsed.messages,
      elements: parsed.elements,
      groups: parsed.groups,
      collapsedGroupIds: new Map(),
    };
  }

  const byName = new Map(parsed.groups.map((g) => [g.name, g]));

  /**
   * Is some ancestor of this group collapsed? A group inside a collapsed one
   * is not drawn at all — its members were already absorbed into the ancestor's
   * virtual participant, so it has nothing left to frame.
   */
  const insideCollapsed = (group: SequenceGroup): boolean => {
    let parentName = group.parent;
    const seen = new Set<string>();
    while (parentName !== undefined && !seen.has(parentName)) {
      seen.add(parentName);
      const ancestor = byName.get(parentName);
      if (!ancestor) return false;
      if (collapsedGroups.has(ancestor.lineNumber)) return true;
      parentName = ancestor.parent;
    }
    return false;
  };

  // Build memberToGroup map: participantId → group name (as virtual ParticipantId).
  // Group names become virtual participant IDs post-collapse — they're minted here
  // and the rest of the pipeline treats them as bona fide ParticipantIds.
  //
  // 🔴 Shallowest group first, and a member already claimed is never
  // re-claimed: when both a group and one nested inside it are collapsed, the
  // OUTER one wins. Collapsing a container has to take everything in it —
  // otherwise the inner group would mint a virtual participant that the outer
  // one has already swallowed, and the same lifeline would be drawn twice.
  const memberToGroup = new Map<ParticipantId, ParticipantId>();
  const collapsedGroupNames = new Set<string>();
  const byDepth = [...parsed.groups].sort((a, b) => a.depth - b.depth);
  for (const group of byDepth) {
    if (!collapsedGroups.has(group.lineNumber)) continue;
    if (insideCollapsed(group)) continue;
    collapsedGroupNames.add(group.name);
    for (const memberId of group.participantIds) {
      if (!memberToGroup.has(memberId)) {
        memberToGroup.set(memberId, group.name as ParticipantId);
      }
    }
  }

  // Participants: remove members of collapsed groups, insert virtual participant per group
  // Skip non-member participants that collide with a collapsed group name
  const participants: SequenceParticipant[] = [];
  const insertedGroups = new Set<string>();

  for (const p of parsed.participants) {
    const groupName = memberToGroup.get(p.id);
    if (groupName) {
      // Replace first occurrence with virtual group participant
      if (!insertedGroups.has(groupName)) {
        insertedGroups.add(groupName);
        const group = parsed.groups.find(
          (g) => g.name === groupName && collapsedGroups.has(g.lineNumber)
        )!;
        participants.push({
          id: groupName, // already ParticipantId from memberToGroup value type
          label: groupName,
          type: 'default',
          lineNumber: group.lineNumber,
        });
      }
      // Skip member — it's absorbed into the group
    } else if (collapsedGroupNames.has(p.id)) {
      // Skip — participant name collides with a collapsed group name;
      // the virtual group participant takes precedence
    } else {
      participants.push(p);
    }
  }

  // Remap helper — collapse member IDs to their group's virtual participant ID.
  const remap = (id: ParticipantId): ParticipantId =>
    memberToGroup.get(id) ?? id;

  // Messages: remap from/to, preserving order
  const messages: SequenceMessage[] = parsed.messages.map((msg) => ({
    ...msg,
    from: remap(msg.from),
    to: remap(msg.to),
  }));

  // Elements: deep clone with remapping and internal return suppression
  const elements = remapElements(parsed.elements, memberToGroup);

  // Groups: remove collapsed groups (they're now virtual participants) and
  // everything nested inside one. A surviving OUTER group keeps its frame but
  // its member list is remapped, because a collapsed inner group's members no
  // longer exist as columns — the virtual participant standing in for them
  // does, and it has to sit inside the outer frame.
  const groups = parsed.groups
    .filter((g) => !collapsedGroups.has(g.lineNumber) && !insideCollapsed(g))
    .map((g) => {
      const remapped: ParticipantId[] = [];
      for (const id of g.participantIds) {
        const to = memberToGroup.get(id) ?? id;
        if (!remapped.includes(to)) remapped.push(to);
      }
      return { ...g, participantIds: remapped };
    });

  return {
    participants,
    messages,
    elements,
    groups,
    collapsedGroupIds: memberToGroup,
  };
}

/**
 * Deep clone and remap elements, suppressing internal returns within collapsed groups.
 */
function remapElements(
  elements: readonly SequenceElement[],
  memberToGroup: Map<ParticipantId, ParticipantId>
): SequenceElement[] {
  const remap = (id: ParticipantId): ParticipantId =>
    memberToGroup.get(id) ?? id;
  const result: SequenceElement[] = [];

  for (const el of elements) {
    if (isSequenceSection(el)) {
      // Sections have no participant references — pass through unchanged
      result.push(el);
    } else if (isSequenceNote(el)) {
      // Remap note participant
      result.push({
        ...el,
        participantId: remap(el.participantId),
      });
    } else if (isSequenceBlock(el)) {
      // Recurse into block children
      result.push({
        ...el,
        children: remapElements(el.children, memberToGroup),
        elseChildren: remapElements(el.elseChildren, memberToGroup),
        ...(el.elseIfBranches
          ? {
              elseIfBranches: el.elseIfBranches.map((branch) => ({
                ...branch,
                children: remapElements(branch.children, memberToGroup),
              })),
            }
          : {}),
      });
    } else {
      // Message element (narrowed by discriminator: kind === 'message')
      const msg = el;
      const from = remap(msg.from);
      const to = remap(msg.to);

      // Suppress internal return: both endpoints in same collapsed group
      // and this is a return message (unlabeled response)
      if (from === to && from !== msg.from && !msg.label) {
        continue; // internal return suppressed
      }

      result.push({ ...msg, from, to });
    }
  }

  return result;
}
