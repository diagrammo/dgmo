import {
  ChartType,
  TagKeyword,
  DirectiveKeyword,
  ControlKeyword,
  ModifierKeyword,
} from './dgmo.grammar.terms.js';
import {
  CHART_TYPES,
  TAG_KEYWORD,
  DIRECTIVE_KEYWORDS,
  CONTROL_KEYWORDS,
  STATUS_KEYWORDS,
  MODIFIER_KEYWORDS,
} from './keywords';

/**
 * Keyword specializer for the Lezer grammar.
 * Called on every Identifier token — returns a specialized term ID
 * or -1 to keep it as a plain Identifier.
 */
export function specializeKeyword(value: string): number {
  if (CHART_TYPES.has(value)) return ChartType;
  if (value === TAG_KEYWORD) return TagKeyword;
  if (DIRECTIVE_KEYWORDS.has(value)) return DirectiveKeyword;
  if (CONTROL_KEYWORDS.has(value)) return ControlKeyword;
  if (STATUS_KEYWORDS.has(value)) return ModifierKeyword;
  if (MODIFIER_KEYWORDS.has(value)) return ModifierKeyword;
  return -1;
}
