import * as _lezer_lr from '@lezer/lr';
import { LanguageSupport, LRLanguage } from '@codemirror/language';
import { NodePropSource } from '@lezer/common';

/** All supported DGMO chart types. */
declare const CHART_TYPES: Set<string>;
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

export {
  CHART_TYPES,
  METADATA_KEYS,
  dgmoExtension,
  dgmoHighlighting,
  dgmoLanguage,
  dgmoLanguageSupport,
  dgmoParser,
};
