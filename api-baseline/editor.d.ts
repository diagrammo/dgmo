import * as _lezer_lr from '@lezer/lr';
import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { NodePropSource } from '@lezer/common';

/**
 * All supported DGMO chart types.
 *
 * Derived from `chart-types.ts` — the same de-duplication already done for
 * DIRECTIVE/CONTROL/STATUS/MODIFIER below, which this list was left out of.
 * Internal types stay in: `live-link` must still highlight when one is open,
 * even though no picker offers it.
 */
declare const CHART_TYPES: ReadonlySet<string>;
/** Metadata keys recognized across chart types. */
declare const METADATA_KEYS: Set<string>;

/** Maps grammar node names to semantic highlight tags. */
declare const dgmoHighlighting: NodePropSource;

/** The raw Lezer parser for DGMO. */
declare const dgmoParser: _lezer_lr.LRParser;
/** LRLanguage wrapper for CodeMirror. */
declare const dgmoLanguage: LRLanguage;
/** Full language support (language + extensions). */
declare const dgmoLanguageSupport: LanguageSupport;
/**
 * Drop-in replacement for the old dgmoExtension.
 * Consumers should add indentationMarkers() separately if desired
 * (from @replit/codemirror-indentation-markers).
 */
declare const dgmoExtension: LanguageSupport;

export { CHART_TYPES, METADATA_KEYS, dgmoExtension, dgmoHighlighting, dgmoLanguage, dgmoLanguageSupport, dgmoParser };
