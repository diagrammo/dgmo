import type { NodePropSource } from '@lezer/common';
import { styleTags, tags as t } from '@lezer/highlight';

/** Maps grammar node names to semantic highlight tags. */
export const dgmoHighlighting: NodePropSource = styleTags({
  Comment: t.lineComment,
  ChartType: t.typeName,
  TagKeyword: t.definitionKeyword,
  DirectiveKeyword: t.keyword,
  ControlKeyword: t.controlKeyword,
  ModifierKeyword: t.modifier,
  SyncArrow: t.operator,
  AsyncArrow: t.operator,
  Number: t.number,
  Percentage: t.number,
  SectionMarker: t.heading,
  OpenBracket: t.squareBracket,
  CloseBracket: t.squareBracket,
  OpenParen: t.paren,
  CloseParen: t.paren,
  OpenAngle: t.angleBracket,
  CloseAngle: t.angleBracket,
  Url: t.url,
  ColorAnnotation: t.atom,
  Pipe: t.separator,
  Colon: t.separator,
  Plus: t.separator,
  Comma: t.punctuation,
  Dash: t.operator,
  Tilde: t.operator,
  Star: t.operator,
  Question: t.operator,
  Punct: t.punctuation,
});
