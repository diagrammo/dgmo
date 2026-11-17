// ============================================================
// Ownership chart diagnostic catalog (#1873)
// ============================================================
//
// Every coded diagnostic the ownership parser emits. The parser reaches these
// through `emit(OWNERSHIP_DX.<KEY>, line, params)`, so catalog consumers can
// list them without re-typing the wording. Every message builder tolerates
// `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const OWNERSHIP_DX = {
  OVER_100: {
    code: 'E_OWNERSHIP_OVER_100',
    severity: 'error',
    chartType: 'ownership',
    title: 'Owners hold more than 100%',
    message: (p) =>
      `The owners of ${(p.entity as string) ?? 'this entity'} hold ${(p.total as string) ?? 'more than 100'}% between them, more than 100%.`,
    hint: 'Check each stake written into this entity, under its parent and in every `NN% -> Name` line.',
    example: `ownership Group\n\nHoldings Ltd\n  60% Sub Ltd\nFund LP\n  40% -> Sub Ltd`,
  },
  UNKNOWN_ENTITY: {
    code: 'E_OWNERSHIP_UNKNOWN_ENTITY',
    severity: 'error',
    chartType: 'ownership',
    title: 'Link to an entity that does not exist',
    message: (p) =>
      `'${(p.name as string) ?? 'name'}' is not an entity in this chart.${p.hint ? ` ${p.hint as string}` : ''}`,
    hint: 'A `NN% -> Name` line points at an entity declared elsewhere in the chart. Check the spelling, or declare the entity.',
    example: `ownership Group\n\nHoldings Ltd\n  100% Sub Ltd\nFund LP\n  40% -> Sub Ltd`,
  },
  CYCLE: {
    code: 'W_OWNERSHIP_CYCLE',
    severity: 'warning',
    chartType: 'ownership',
    title: 'Ownership goes round in a circle',
    message: (p) =>
      `Ownership goes round in a circle: ${(p.cycle as string) ?? 'these entities own each other'}. The chart still draws; effective ownership stops at the circle.`,
    hint: 'A circle is legal (cross-shareholdings exist), but check that each stake points the right way.',
    example: `ownership Group\n\nA Ltd\n  50% B Ltd\n    10% -> A Ltd`,
  },
  FORCED_CROSSING: {
    code: 'W_OWNERSHIP_FORCED_CROSSING',
    severity: 'warning',
    chartType: 'ownership',
    title: 'Two lines must cross',
    message: (p) =>
      `The line ${(p.a as string) ?? 'one link'} crosses ${(p.b as string) ?? 'another link'}; this structure leaves no way to draw them apart.`,
    hint: 'The layout keeps lines apart wherever it can. This crossing comes from the ownership itself; reorder nothing, or split the chart.',
    example: `ownership Group\n\nA Ltd\n  50% C Ltd\n  50% D Ltd\nB Ltd\n  50% -> C Ltd\n  50% -> D Ltd`,
  },
  BAD_STAKE: {
    code: 'E_OWNERSHIP_BAD_STAKE',
    severity: 'error',
    chartType: 'ownership',
    title: 'Stake is not a percentage',
    message: (p) =>
      `'${(p.stake as string) ?? 'stake'}' is not a stake above 0% and at most 100%.`,
    hint: 'Write the stake as a number and a percent sign: `60%`, `33.3%`, `100%`.',
    example: `ownership Group\n\nHoldings Ltd\n  33.3% Sub Ltd`,
  },
  MISSING_NAME: {
    code: 'E_OWNERSHIP_MISSING_NAME',
    severity: 'error',
    chartType: 'ownership',
    title: 'Stake with no entity',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' gives a stake but names no entity.`,
    hint: 'Write `NN% Name` for a subsidiary, or `NN% -> Name` for a stake in an entity declared elsewhere.',
    example: `ownership Group\n\nHoldings Ltd\n  100% Sub Ltd`,
  },
  DUPLICATE_ENTITY: {
    code: 'E_OWNERSHIP_DUPLICATE_ENTITY',
    severity: 'error',
    chartType: 'ownership',
    title: 'Entity declared twice',
    message: (p) =>
      `'${(p.name as string) ?? 'name'}' is already declared on line ${(p.first as number) ?? '?'}.`,
    hint: 'Declare each entity once. For a second owner, write `NN% -> Name` under that owner.',
    example: `ownership Group\n\nHoldings Ltd\n  90% Sub Ltd\n  100% Other Ltd\n    10% -> Sub Ltd`,
  },
  DUPLICATE_LINK: {
    code: 'E_OWNERSHIP_DUPLICATE_LINK',
    severity: 'error',
    chartType: 'ownership',
    title: 'Same stake written twice',
    message: (p) =>
      `${(p.owner as string) ?? 'This owner'} already holds a stake in ${(p.owned as string) ?? 'this entity'} (line ${(p.first as number) ?? '?'}).`,
    hint: 'Write one line per owner and owned entity, with the total stake.',
    example: `ownership Group\n\nHoldings Ltd\n  100% Sub Ltd`,
  },
  SELF_LINK: {
    code: 'E_OWNERSHIP_SELF_LINK',
    severity: 'error',
    chartType: 'ownership',
    title: 'Entity owns itself',
    message: (p) =>
      `'${(p.name as string) ?? 'This entity'}' cannot hold a stake in itself.`,
    hint: 'Point the `->` at another entity. Treasury shares are not drawn.',
    example: `ownership Group\n\nHoldings Ltd\n  100% Sub Ltd`,
  },
  BAD_TYPE: {
    code: 'E_OWNERSHIP_BAD_TYPE',
    severity: 'error',
    chartType: 'ownership',
    title: 'Unknown entity type',
    message: (p) =>
      `'${(p.value as string) ?? 'type'}' is not an entity type.${p.hint ? ` ${p.hint as string}` : ''}`,
    hint: '`type:` takes corporation (the default), partnership, individual or trust.',
    example: `ownership Group\n\nFund LP  type: partnership`,
  },
  ORPHAN_LINE: {
    code: 'E_OWNERSHIP_ORPHAN_LINE',
    severity: 'error',
    chartType: 'ownership',
    title: 'Line belongs to no entity',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' must sit indented under an entity.`,
    hint: 'Stakes, metadata and description lines go indented under the entity they belong to.',
    example: `ownership Group\n\nHoldings Ltd\n  Listed on the LSE\n  100% Sub Ltd`,
  },
  NO_ENTITIES: {
    code: 'E_OWNERSHIP_NO_ENTITIES',
    severity: 'error',
    chartType: 'ownership',
    title: 'Nothing to draw',
    message: () => 'The chart declares no entities.',
    hint: 'Write the top entity at the start of a line, then its subsidiaries indented under it as `NN% Name`.',
    example: `ownership Group\n\nHoldings Ltd\n  100% Sub Ltd`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const OWNERSHIP_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(OWNERSHIP_DX);
