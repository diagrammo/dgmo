// ============================================================
// Generic diagram notes — barrel
// ============================================================
//
// One chart-neutral note pipeline: model → parse → resolve → place →
// shift, plus the shared `note-box` drawer. A node-based chart adopts
// notes by importing from here and supplying only an anchor list and the
// per-chart layout wiring. See the cross-chart rollout tech spec.

export * from './model';
export * from './parse';
export * from './resolve';
export * from './place';
export * from './build';
export * from './bounds';

// Re-export the drawer so charts have one import site for the whole feature.
export * from '../note-box';
