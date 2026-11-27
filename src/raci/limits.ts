// ============================================================
// raci — the role and task limits (#2460)
// ============================================================
//
// A RACI matrix is read cell by cell, so every cell has to stay legible.
// Past either limit the parser keeps the first roles (column order) and the
// first tasks (source order), and raises one error per limit on the first
// role or task left out. Under the limits the renderer scales the grid to fit
// the canvas both ways. Not author-tunable: crowding is the renderer's
// decision (dgmo/CLAUDE.md → Output rules).
//
// How the numbers were chosen (2026-11-27, measured by rendering a full grid
// — one A, two R, the rest C/I — at 1200×800, the default canvas):
// - Roles: on export each column keeps ROLE_COL_MIN (64 px), so past 14 roles
//   the grid is drawn wider than 1200 and scaled down. The 12 px role headers
//   stay at or above MIN_READABLE_TYPE_PX (11 px) up to 16 roles (×0.94,
//   11.3 px); 17 roles is ×0.90, 10.8 px; 20 roles is 9.4 px.
// - Tasks: in a 1200×800 preview pane at 16 roles, 40 task rows fill the pane
//   with task labels at TEXT_FLOOR (9 px) and no fit scaling; 50 rows scale
//   the grid to ×0.81, 7.3 px.

/** Most role columns one RACI matrix draws. */
export const MAX_RACI_ROLES = 16;

/** Most task rows one RACI matrix draws, counted across all phases. */
export const MAX_RACI_TASKS = 40;
