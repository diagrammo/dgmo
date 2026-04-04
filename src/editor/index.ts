import { LRLanguage, LanguageSupport } from '@codemirror/language';
import { parser } from './dgmo.grammar.js';
import { dgmoHighlighting } from './highlight';

export { CHART_TYPES, METADATA_KEYS } from './keywords';
export { dgmoHighlighting } from './highlight';

/** The raw Lezer parser for DGMO. */
export const dgmoParser = parser.configure({
  props: [dgmoHighlighting],
});

/** LRLanguage wrapper for CodeMirror. */
export const dgmoLanguage = LRLanguage.define({
  name: 'dgmo',
  parser: dgmoParser,
});

/** Full language support (language + extensions). */
export const dgmoLanguageSupport = new LanguageSupport(dgmoLanguage);

/**
 * Drop-in replacement for the old dgmoExtension.
 * Consumers should add indentationMarkers() separately if desired
 * (from @replit/codemirror-indentation-markers).
 */
export const dgmoExtension = dgmoLanguageSupport;
