// ============================================================
// Alias integrity diagnostics (TD-18, spec §2A.2)
// ============================================================
//
// The eight coded diagnostics for `Name as <alias>`. Universal — the alias
// postfix applies to every chart type with named entities, so none of these
// carries an owning chart type.
//
// The wording is the catalog the universal-alias tech spec pinned as
// user-facing API (`tech-spec-universal-alias-syntax.md` § "P2 — Diagnostic
// message text appendix"); it is reproduced here rather than paraphrased so
// the two do not drift. The rules themselves are decided in
// `utils/alias-registry.ts` — this file only says how they read.

import type { DiagnosticSpec } from './diagnostics';

export const ALIAS_INVALID_FORMAT_DX: DiagnosticSpec = {
  code: 'E_ALIAS_INVALID_FORMAT',
  severity: 'error',
  chartType: null,
  title: 'Malformed alias',
  message: (p) =>
    `Alias '${String(p.alias ?? 'pm-cluster')}' must start with a letter and use only letters, digits and underscores, up to 12 characters.`,
  hint: 'Shorten the alias or drop the hyphen — a malformed one is not peeled off, so the whole `Name as …` string becomes the name.',
  example: 'org\nAlice as thirteencharss\n  Bob as b\n',
};

export const ALIAS_RESERVED_KEYWORD_DX: DiagnosticSpec = {
  code: 'E_ALIAS_RESERVED_KEYWORD',
  severity: 'error',
  chartType: null,
  title: 'Alias is a reserved keyword',
  message: (p) =>
    `'${String(p.alias ?? 'tag')}' is a reserved keyword and cannot be used as an alias.`,
  hint: 'Grammar keywords (`as`, `is`, `tag`, `alias`, `aka`) and chart-type names are reserved. Articles are not — `Alice as a` is fine.',
  example: 'org\nAlice as tag\n  Bob as b\n',
};

export const ALIAS_COLLISION_DX: DiagnosticSpec = {
  code: 'E_ALIAS_COLLISION',
  severity: 'error',
  chartType: null,
  title: 'Alias already bound',
  message: (p) =>
    `Alias '${String(p.alias ?? 'a')}' is already bound to '${String(p.previousCanonical ?? 'Alice')}' (line ${String(p.previousLine ?? 2)}). Cannot rebind to '${String(p.canonical ?? 'Bob')}'.`,
  hint: 'One alias literal has exactly one binding per source — choose a different alias.',
  example: 'org\nAlice as a\n  Bob as a\n',
};

export const ALIAS_REBINDING_DX: DiagnosticSpec = {
  code: 'E_ALIAS_REBINDING',
  severity: 'error',
  chartType: null,
  title: 'Name aliased twice',
  message: (p) =>
    `'${String(p.canonical ?? 'Alice')}' is already aliased as '${String(p.previousAlias ?? p.alias ?? 'a')}' (line ${String(p.previousLine ?? 2)}). Cannot also alias as '${String(p.alias ?? 'al')}'.`,
  hint: 'Keep one alias per name and use it everywhere.',
  example: 'org\nAlice as a\n  Alice as al\n',
};

export const ALIAS_SHADOWS_NAME_DX: DiagnosticSpec = {
  code: 'E_ALIAS_SHADOWS_NAME',
  severity: 'error',
  chartType: null,
  title: 'Alias shadows a name',
  message: (p) =>
    `Alias '${String(p.alias ?? 'Bob')}' would shadow an existing canonical name. Choose a different alias.`,
  hint: 'A token that is both a name and an alias reads as two things at every later use.',
  example: 'org\nAlice as Bob\n  Bob as b\n',
};

export const ALIAS_OF_ALIAS_DX: DiagnosticSpec = {
  code: 'E_ALIAS_OF_ALIAS',
  severity: 'error',
  chartType: null,
  title: 'Alias of an alias',
  message: (p) =>
    `'${String(p.canonical ?? 'a')}' is itself an alias for '${String(p.target ?? 'Alice')}'. Cannot alias an alias — alias the canonical instead.`,
  hint: 'Write the canonical name on the left of `as`.',
  example: 'org\nAlice as a\n  a as b\n',
};

export const ALIAS_BEFORE_DECL_DX: DiagnosticSpec = {
  code: 'E_ALIAS_BEFORE_DECL',
  severity: 'error',
  chartType: null,
  title: 'Alias used before declaration',
  message: (p) =>
    `Alias '${String(p.alias ?? 'b')}' used before declaration. Declare '${String(p.canonical ?? 'Bob')} as ${String(p.alias ?? 'b')}' on or above this line.`,
  hint: 'DGMO is single-pass — move the declaration above its first use.',
  example: 'boxes-and-lines\n[A]\n  b\n[B] as b\n',
};

export const ALIAS_AFTER_CANONICAL_DX: DiagnosticSpec = {
  code: 'E_ALIAS_AFTER_CANONICAL',
  severity: 'error',
  chartType: null,
  title: 'Alias declared after the name was used',
  message: (p) =>
    `'${String(p.canonical ?? 'Alice')}' was already used as a canonical name (line ${String(p.firstLine ?? 2)}). Aliases must be declared on or before first use.`,
  hint: 'Declare the alias where the name first appears.',
  example: 'sequence\nAlice is an actor\nBob is a database\nAlice as a\n',
};

export const ALIAS_DIAGNOSTICS: DiagnosticSpec[] = [
  ALIAS_INVALID_FORMAT_DX,
  ALIAS_RESERVED_KEYWORD_DX,
  ALIAS_COLLISION_DX,
  ALIAS_REBINDING_DX,
  ALIAS_SHADOWS_NAME_DX,
  ALIAS_OF_ALIAS_DX,
  ALIAS_BEFORE_DECL_DX,
  ALIAS_AFTER_CANONICAL_DX,
];
