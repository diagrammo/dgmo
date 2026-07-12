// ============================================================
// Body chart — figure selection + anatomy name resolution
// ============================================================
//
// Picks the figure asset for a (sex, view) and maps user-typed part names
// (formal anatomical OR gym shorthand) to a canonical catalog key present in
// that figure. Shared by the parser (unknown-part validation) and the renderer
// (geometry lookup). Lifted from the prototype's ANATOMICAL + MUS_ALIAS maps.

import { FIGURES } from './assets/figures';
import { SURFACE } from './assets/surface';
import type {
  BodyFigure,
  BodyPartGeometry,
  BodySex,
  BodyView,
  FigureKey,
} from './types';

/** Reverse lookup: figure object → its key, so we can find its surface set. */
const FIG_KEY = new Map<BodyFigure, FigureKey>(
  Object.entries(FIGURES).map(([k, f]) => [f, k as FigureKey])
);
const surfaceFor = (figure: BodyFigure): Record<string, BodyPartGeometry> => {
  const key = FIG_KEY.get(figure);
  const set = key ? SURFACE[key] : undefined;
  return (set as Record<string, BodyPartGeometry>) ?? {};
};

export function figureKey(sex: BodySex, view: BodyView): FigureKey {
  return `${sex}${view === 'front' ? 'Front' : 'Back'}` as FigureKey;
}

export function getFigure(sex: BodySex, view: BodyView): BodyFigure {
  return FIGURES[figureKey(sex, view)];
}

/** Formal anatomical names → catalog canonical. */
const ANATOMICAL: Readonly<Record<string, string>> = {
  'pectoralis-major': 'chest',
  pectoralis: 'chest',
  'rectus-abdominis': 'abs',
  abdominals: 'abs',
  'biceps-brachii': 'biceps',
  'triceps-brachii': 'triceps',
  'quadriceps-femoris': 'quadriceps',
  'external-oblique': 'obliques',
  gastrocnemius: 'calves',
  'latissimus-dorsi': 'lats',
  latissimus: 'lats',
  'gluteus-maximus': 'glute-maximus',
  'gluteus-medius': 'glute-medius',
  'erector-spinae': 'erector-spinae',
  'quadratus-lumborum': 'quadratus-lumborum',
  'biceps-femoris': 'biceps-femoris',
  'anterior-deltoid': 'front-delts',
  'lateral-deltoid': 'side-delts',
  'posterior-deltoid': 'rear-delts',
};

/**
 * Gym shorthand, fine-name fallbacks, and surface-landmark → region aliases.
 * A value may list several candidates, tried in order against the figure (so
 * `thigh` resolves to quadriceps on a front view, hamstring on a back view).
 */
const ALIAS: Readonly<Record<string, string | readonly string[]>> = {
  pecs: 'chest',
  pec: 'chest',
  delts: 'deltoids',
  delt: 'deltoids',
  shoulders: 'deltoids',
  shoulder: 'deltoids',
  quads: 'quadriceps',
  quad: 'quadriceps',
  bicep: 'biceps',
  bis: 'biceps',
  tricep: 'triceps',
  tris: 'triceps',
  calf: 'calves',
  traps: 'trapezius',
  trap: 'trapezius',
  shins: 'tibialis',
  shin: 'tibialis',
  serratus: 'serratus-anterior',
  lat: 'lats',
  glutes: 'gluteal',
  glute: 'gluteal',
  butt: 'gluteal',
  hamstrings: 'hamstring',
  hams: 'hamstring',
  'lower-back': 'lower-back',
  'upper-back': 'upper-back',
  // Surface-region words that point at a whole muscle group.
  thigh: ['quadriceps', 'hamstring'],
  thighs: ['quadriceps', 'hamstring'],
  foot: 'feet',
  hand: 'hands',
  knee: 'knees',
  waist: 'obliques',
  back: ['upper-back', 'lats'],
};

/**
 * Every name a user may type on a body part line — canonical muscles, surface
 * landmarks, formal-anatomical + gym aliases, and the `left`/`right` side
 * modifier. Single source for editor autocomplete and syntax highlighting.
 */
export const BODY_TERMS: readonly string[] = [
  ...new Set([
    ...Object.values(FIGURES).flatMap((f) => Object.keys(f.parts)),
    ...Object.values(SURFACE).flatMap((f) => Object.keys(f)),
    ...Object.keys(ANATOMICAL),
    ...Object.keys(ALIAS),
    'left',
    'right',
  ]),
].sort();

/**
 * Normalize a user-typed name to a catalog key present in `figure`, or null.
 * Tries: verbatim (muscle or surface), formal anatomical, alias candidates,
 * then the fine-deltoid fallback.
 */
export function resolvePartKey(
  figure: BodyFigure,
  name: string
): string | null {
  const n = name.toLowerCase();
  const surface = surfaceFor(figure);
  const has = (k: string): boolean => !!figure.parts[k] || !!surface[k];
  if (has(n)) return n;
  const anat = ANATOMICAL[n];
  if (anat && has(anat)) return anat;
  const al = ALIAS[n];
  if (al) {
    for (const cand of Array.isArray(al) ? al : [al]) {
      if (has(cand)) return cand;
    }
  }
  // Fine delt names fall back to the whole deltoid where the art isn't split.
  if (
    (n === 'front-delts' || n === 'side-delts' || n === 'rear-delts') &&
    figure.parts['deltoids']
  )
    return 'deltoids';
  return null;
}

/**
 * Geometry for a resolved key — a muscle (with fill paths) or a surface
 * landmark (leader-only: empty paths + anchor/centers).
 */
export function getPartGeom(
  figure: BodyFigure,
  key: string
): BodyPartGeometry | null {
  const muscle = figure.parts[key];
  if (muscle) return muscle;
  const surf = surfaceFor(figure)[key];
  if (surf)
    return {
      paths: [],
      anchor: surf.anchor,
      ...(surf.centers && { centers: surf.centers }),
    };
  return null;
}
