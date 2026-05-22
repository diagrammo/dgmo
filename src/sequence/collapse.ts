// ============================================================
// Collapse Projection for Sequence Diagram Groups
// ============================================================
//
// Pure projection function that transforms a parsed sequence diagram
// by collapsing specified groups into single virtual participants.
// The parsed AST (ParsedSequenceDgmo) stays immutable.

import type {
  ParsedSequenceDgmo,
  SequenceElement,
  SequenceGroup,
  SequenceMessage,
  SequenceParticipant,
} from './parser';
import { isSequenceBlock, isSequenceNote, isSequenceSection } from './parser';

export interface CollapsedView {
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  elements: SequenceElement[];
  groups: SequenceGroup[];
  /** Maps member participant ID → collapsed group name */
  collapsedGroupIds: Map<string, string>;
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

  // Build memberToGroup map: participantId → group name
  const memberToGroup = new Map<string, string>();
  const collapsedGroupNames = new Set<string>();
  for (const group of parsed.groups) {
    if (collapsedGroups.has(group.lineNumber)) {
      collapsedGroupNames.add(group.name);
      for (const memberId of group.participantIds) {
        memberToGroup.set(memberId, group.name);
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
          id: groupName,
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

  // Remap helper
  const remap = (id: string): string => memberToGroup.get(id) ?? id;

  // Messages: remap from/to, preserving order
  const messages: SequenceMessage[] = parsed.messages.map((msg) => ({
    ...msg,
    from: remap(msg.from),
    to: remap(msg.to),
  }));

  // Elements: deep clone with remapping and internal return suppression
  const elements = remapElements(parsed.elements, memberToGroup);

  // Groups: remove collapsed groups (they're now virtual participants)
  const groups = parsed.groups.filter(
    (g) => !collapsedGroups.has(g.lineNumber)
  );

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
  elements: SequenceElement[],
  memberToGroup: Map<string, string>
): SequenceElement[] {
  const remap = (id: string): string => memberToGroup.get(id) ?? id;
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
