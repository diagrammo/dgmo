// ============================================================
// Ownership chart text — hover cards and the <desc> summary
// ============================================================

import { escapeHtml } from '../embed/escape';
import { stripInlineMarkdown } from '../utils/inline-markdown';
import { tagAttrKey } from '../utils/tag-groups';
import { effectiveOwnership } from './effective';
import { TYPE_LABELS } from './layout';
import { formatPct } from './parser';
import type { OwnershipEntity, OwnershipLink, ParsedOwnership } from './types';

/** "UK · Corporation", from every tag value the entity has, then its type. */
export function entityFacts(
  parsed: ParsedOwnership,
  entity: OwnershipEntity
): string {
  const values: string[] = [];
  for (const group of parsed.tagGroups) {
    const raw = entity.metadata[tagAttrKey(group.name)];
    if (!raw) continue;
    values.push(
      group.entries.find((e) => e.value.toLowerCase() === raw.toLowerCase())
        ?.value ?? raw
    );
  }
  return [...values, TYPE_LABELS[entity.type]].join(' · ');
}

/** The effective-ownership lines of an entity's card, as plain text. */
export function effectiveLines(
  parsed: ParsedOwnership,
  entityId: string
): { owner: string; outside: boolean; total: string; paths: string[] }[] {
  const byId = new Map(parsed.entities.map((e) => [e.id, e]));
  return effectiveOwnership(parsed, entityId).owners.map((o) => ({
    owner: byId.get(o.id)!.name,
    outside: byId.get(o.id)!.outside,
    total: `${formatPct(o.total)}%`,
    paths: o.paths.map((p) => {
      const via = p.chain.slice(1, -1).map((id) => byId.get(id)!.name);
      return `${formatPct(p.pct)}% ${via.length ? `via ${via.join(' → ')}` : 'direct'}`;
    }),
  }));
}

/** The hover card for an entity, as HTML. */
export function entityCardHtml(
  parsed: ParsedOwnership,
  entity: OwnershipEntity
): string {
  const parts: string[] = [
    `<strong>${escapeHtml(entity.name)}</strong>`,
    `<div style="opacity:.75">${escapeHtml(entityFacts(parsed, entity))}${
      entity.outside ? ' · outside the group' : ''
    }</div>`,
  ];
  if (entity.description.length > 0) {
    parts.push(
      `<div style="margin-top:4px;font-style:italic">${entity.description
        .map((l) => escapeHtml(stripInlineMarkdown(l)))
        .join('<br>')}</div>`
    );
  }
  const lines = effectiveLines(parsed, entity.id);
  if (lines.length > 0) {
    parts.push(
      '<div style="margin-top:6px;font-weight:600">Effective ownership</div>'
    );
    for (const line of lines) {
      const tail = line.outside ? ' <em>(outside the group)</em>' : '';
      const sum =
        line.paths.length > 1
          ? `${line.paths.map(escapeHtml).join(' + ')} = ${line.total}`
          : escapeHtml(line.paths[0] ?? '');
      parts.push(
        `<div>${escapeHtml(line.owner)}${tail}: <strong>${line.total}</strong></div>` +
          `<div style="opacity:.75;padding-left:8px">${sum}</div>`
      );
    }
  }
  const direct = effectiveOwnership(parsed, entity.id).directTotal;
  if (direct > 0 && direct < 100 - 1e-6) {
    parts.push(
      `<div style="margin-top:4px;opacity:.75">${formatPct(100 - direct)}% not shown</div>`
    );
  }
  return parts.join('');
}

/** The hover card for a link, as HTML. */
export function linkCardHtml(
  parsed: ParsedOwnership,
  link: OwnershipLink
): string {
  const byId = new Map(parsed.entities.map((e) => [e.id, e]));
  return (
    `<strong>${escapeHtml(byId.get(link.ownerId)!.name)} → ${escapeHtml(byId.get(link.ownedId)!.name)}</strong>` +
    `<div>Stake: ${link.pctText}%</div>`
  );
}

/** Screen-reader name of an entity. */
export function entityAriaLabel(
  parsed: ParsedOwnership,
  entity: OwnershipEntity
): string {
  const owners = parsed.links
    .filter((l) => l.ownedId === entity.id)
    .map((l) => {
      const o = parsed.entities.find((e) => e.id === l.ownerId)!;
      return `${l.pctText}% by ${o.name}`;
    });
  return [
    entity.name,
    entityFacts(parsed, entity),
    entity.outside ? 'outside the group' : '',
    owners.length ? `owned ${owners.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

/** One line for the SVG <desc>. */
export function ownershipSummary(parsed: ParsedOwnership): string {
  const inside = parsed.entities.filter((e) => !e.outside).length;
  const outside = parsed.entities.length - inside;
  const root = parsed.entities.find((e) => e.id === parsed.rootId);
  const plural = (n: number, one: string, many: string): string =>
    `${n} ${n === 1 ? one : many}`;
  return (
    `Ownership chart of ${plural(inside, 'entity', 'entities')} in the group` +
    (root ? ` under ${root.name}` : '') +
    (outside
      ? `, with ${plural(outside, 'outside owner', 'outside owners')}`
      : '') +
    `; ${plural(parsed.links.length, 'stake', 'stakes')}.`
  );
}
