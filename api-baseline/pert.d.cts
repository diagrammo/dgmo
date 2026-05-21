type DgmoSeverity = 'error' | 'warning';
interface DgmoError {
    line: number;
    column?: number;
    message: string;
    severity: DgmoSeverity;
    /**
     * Optional stable diagnostic code (e.g. 'E_ARROW_SUBSTRING_IN_LABEL').
     * Additive; pre-existing diagnostics omit this field and existing
     * substring-on-`.message` assertions keep working unchanged.
     */
    code?: string;
}

/** A single entry inside a tag group: `Value color` */
interface TagEntry {
    value: string;
    color: string;
    lineNumber: number;
}
/** A tag group block: heading + entries */
interface TagGroup {
    name: string;
    alias?: string;
    entries: TagEntry[];
    /** Default value for nodes without explicit metadata. First entry unless another is marked `default`. */
    defaultValue?: string;
    lineNumber: number;
}

/** Calendar units: d (days), w (weeks), m (months), q (quarters), y (years), h (hours), min (minutes). bd = business days. s = sprints. */
type DurationUnit = 'd' | 'bd' | 'w' | 'm' | 'q' | 'y' | 'h' | 'min' | 's';
interface Duration {
    amount: number;
    unit: DurationUnit;
}

/**
 * A three-point duration estimate. Each component is a parsed
 * `Duration { amount, unit }` so mixed units (`1w 2w 3m`) are
 * preserved; the analyzer normalizes to `options.timeUnit` for
 * arithmetic.
 */
interface DurationEstimate {
    o: Duration;
    m: Duration;
    p: Duration;
    /**
     * When true, only an M token was given on the source line and the
     * analyzer must expand O/P from confidence factors. When false, the
     * user wrote an explicit O M P triple (even when all three values
     * are equal — zero-variance is a valid, deterministic estimate).
     */
    mOnly: boolean;
}

/** Layout direction. `LR` is the default; `TB` for tall chains. */
type PertDirection = 'LR' | 'TB';
/** `node-detail` directive value. */
type NodeDetail = 'compact' | 'full';
/**
 * Project schedule anchor. Mutually-exclusive at parse time:
 *   - `forward`  — `start-date YYYY-MM-DD` anchors source-activity ES.
 *   - `backward` — `end-date YYYY-MM-DD` anchors sink-activity LF.
 *   - `null`     — no anchor; ES/EF/LS/LF render as numeric offsets.
 */
type Anchor = {
    kind: 'forward';
    date: string;
} | {
    kind: 'backward';
    date: string;
} | null;
/**
 * One row of the project-stats caption. Replaces the previous
 * `\n`-joined `summaryText` string with a structured shape so the
 * renderer doesn't have to recover bullet structure by splitting on
 * `\n` / `. ` and tests can assert on `isPast` directly instead of
 * matching the trailing `(latest-safe start has passed)` suffix.
 */
interface CaptionRow {
    /** Pre-formatted caption text for this row (no leading bullet glyph). */
    text: string;
    /** 0 = top-level row; 1 = sub-row (indented under the previous level-0 row). */
    level: 0 | 1;
    /** When true, renderer paints the text italic. */
    italic?: boolean;
    /**
     * Backward-mode flag — true when the row reports a latest-safe-start
     * date that precedes `options.today`. The text already carries a
     * `(latest-safe start has passed)` suffix; the flag is for downstream
     * styling/test assertions.
     */
    isPast?: boolean;
}
/** Diagram-level options collected by the parser. */
interface PertOptions {
    /** Time unit for μ/σ/ES/EF formatting and M-only heuristics. */
    timeUnit: Duration['unit'];
    /** `direction` directive. Defaults to `LR`. */
    direction: PertDirection;
    /** `node-detail` directive. Defaults to `compact`. */
    nodeDetail: NodeDetail;
    /**
     * Global confidence used to fill O/P from M-only durations.
     * Stored verbatim — analyzer applies `resolveConfidence()` to expand
     * named levels (`high`/`medium`/`low`) or `O/P` factor pairs.
     */
    confidence: string;
    /** Monte-Carlo trials for the canonical run (default 10000). */
    trials: number;
    /** Monte-Carlo seed; deterministic across machines via mulberry32. */
    seed: number;
    /** Fast-MC trials for the live duration scrubber (default 300, floor 100). */
    scrubberTrials: number;
    /**
     * Date anchor — discriminated union enforces mutual exclusion.
     * `null` when no `start-date`/`end-date` directive was authored.
     */
    anchor: Anchor;
    /** When true, the renderer suppresses the diagram banner title. */
    noTitle?: boolean;
    /**
     * `active-tag <name>` directive — selects which declared tag group
     * drives node fill via `resolveTagColor()`. `'none'` (case-insensitive)
     * suppresses tag coloring; `undefined` lets `resolveActiveTagGroup()`
     * auto-activate the first declared group.
     */
    activeTag?: string;
    /**
     * Sprint mode (mirrors Gantt's surface). Activated automatically when
     * `time-unit s` is set, or explicitly when any `sprint-*` directive
     * appears. Schedule cells render as `S<n>` instead of numeric offsets
     * or ISO dates.
     */
    sprintLength: Duration | null;
    sprintNumber: number | null;
    sprintStart: string | null;
    sprintMode: 'auto' | 'explicit' | null;
    /**
     * "Today" baked in at parse time (ISO YYYY-MM-DD). Same source as
     * `start-date now`, captured for every parse regardless of whether
     * `now` was authored. Analyzer reads this to flag past latest-safe
     * starts in backward mode; renderer surfaces it in the
     * `(as of YYYY-MM-DD)` anchor annotation. Empty string when the
     * parser was given no `now` and no `start-date now` directive (legacy
     * fixtures pre-dating this field) — consumers treat empty as
     * "no today known" and skip past-flagging.
     */
    today: string;
}
/**
 * A PERT activity (node). Activities have either a three-point estimate,
 * an M-only estimate (parser fills O/P from confidence factors), or no
 * estimate at all (TBD — analyzer null-poisons descendants).
 */
interface PertActivity {
    /** Stable id — alias if `as` was given, otherwise normalized name. */
    id: string;
    /** Human-readable label as written in source. */
    name: string;
    /** Optional alias from `<name> <durs> as <id>`. */
    alias?: string;
    /**
     * Activity duration estimate.
     * - `null` → TBD (no estimate); analyzer poisons descendants with `null`.
     */
    duration: DurationEstimate | null;
    /**
     * Per-activity confidence override from pipe metadata (`| confidence: low`).
     * When unset, analyzer uses `options.confidence`.
     */
    confidence?: string;
    /** Group id this activity belongs to (post-resolve). */
    groupId?: string;
    /** Source line of the declaration site (1-based). */
    lineNumber: number;
    /** True for `milestone <name>` primitives (zero-duration, diamond shape). */
    isMilestone: boolean;
    /**
     * Resolved tag-group metadata from pipe-metadata aliases. Keys are
     * lowercased tag-group names (e.g. `priority`, `team`); values are the
     * authored tag entry names. Drives node fill via `resolveTagColor()`
     * when an `active-tag` group is set. Empty when no tag groups are
     * declared or the activity carried no tag metadata.
     */
    tags?: Record<string, string>;
}
/**
 * Forward-style milestone shorthand. Stored as a `PertActivity` with
 * `isMilestone: true` and a zero-duration estimate, but kept here as a
 * distinct exported alias for callers that want to filter by kind.
 */
type PertMilestone = PertActivity & {
    isMilestone: true;
};
/**
 * Dependency type — defaults to FS (Finish-to-Start), the dominant case.
 * - FS: `B.ES ≥ A.EF + lag` (most edges)
 * - SS: `B.ES ≥ A.ES + lag` (parallel start)
 * - FF: `B.EF ≥ A.EF + lag` (synchronized finish)
 * - SF: `B.EF ≥ A.ES + lag` (rare; included for completeness)
 */
type EdgeType = 'FS' | 'SS' | 'FF' | 'SF';
/**
 * Directed dependency edge from `source` activity to `target`.
 * `type` defaults to FS, `lag` to null (zero offset). Lag amount may be
 * negative (a lead — predecessor and successor overlap).
 */
interface PertEdge {
    source: string;
    target: string;
    lineNumber: number;
    type: EdgeType;
    lag: Duration | null;
}
/** Group declared via `[group-name] | metadata`. */
interface PertGroup {
    id: string;
    name: string;
    /** Activity ids belonging to this group, populated in Pass 2. */
    activityIds: string[];
    /** Whether the user authored `| collapsed: true`. */
    collapsed: boolean;
    /** Source line of the `[group-name]` header (1-based). */
    lineNumber: number;
    /**
     * Resolved tag-group metadata for the cluster header — same shape as
     * `PertActivity.tags`. Currently informational; default-tag injection
     * skips groups (containers) so they appear "untagged" unless the user
     * authors an explicit value via pipe metadata.
     */
    tags?: Record<string, string>;
    /**
     * Auto-detected group topology (Pass 2 result).
     * - `hammock`: single entry + single exit — collapses to a super-edge.
     * - `cluster`: multi-entry or multi-exit — collapses to a bounding rect.
     */
    classification?: 'hammock' | 'cluster';
}
/** Output of `parsePert(content)`. */
interface ParsedPert {
    /** Optional title parsed from `pert <title>`. */
    title: string | null;
    options: PertOptions;
    activities: PertActivity[];
    edges: PertEdge[];
    groups: PertGroup[];
    /**
     * Tag groups declared at the top of the diagram (`tag Priority as p
     * High red, Low green`). Drive node fill via `resolveTagColor()`.
     * Empty when no `tag` blocks are declared.
     */
    tagGroups: TagGroup[];
    /**
     * Map alias-or-name → canonical activity id. Useful for the analyzer
     * and for editor autocomplete; also populated in Pass 2.
     */
    idMap: Record<string, string>;
    diagnostics: DgmoError[];
    /** First fatal error message; `null` when parse succeeded. */
    error: string | null;
}
/**
 * Fully-resolved per-activity analysis output. ES/EF/LS/LF/slack are
 * `null` for any activity downstream of a TBD (poison-propagation per
 * AC2.3).
 */
interface ResolvedActivity {
    activity: PertActivity;
    /** Earliest start (forward pass). `null` if upstream TBD. */
    es: number | null;
    /** Earliest finish. */
    ef: number | null;
    /** Latest start (backward pass). */
    ls: number | null;
    /** Latest finish. */
    lf: number | null;
    /** Slack = LS − ES (or LF − EF). 0 = on critical path. `null` if poisoned. */
    slack: number | null;
    /** True iff the M-world critical path passes through this activity. */
    isCriticalPath: boolean;
    /** Resolved μ in `options.timeUnit` (numeric mean of o/m/p). */
    mu: number | null;
    /** Resolved σ in `options.timeUnit` (Beta-PERT std dev). */
    sigma: number | null;
    /**
     * Criticality index from Monte Carlo (0–1). `null` when MC is off or
     * when this activity is downstream of a TBD.
     */
    criticality: number | null;
    /**
     * True iff the source declared an explicit O/M/P triple. M-only,
     * TBD, and milestone activities all report `false`.
     */
    isAuthored: boolean;
}
/** Resolved hammock/cluster group. */
interface ResolvedGroup {
    group: PertGroup;
    /** Aggregate μ/σ along the group's internal critical path. */
    rolledMu: number | null;
    rolledSigma: number | null;
    /** Group entry/exit ids derived in Pass 2. */
    entries: string[];
    exits: string[];
    /**
     * Rolled-up schedule envelope across member activities.
     *   ES = min member.es
     *   EF = max member.ef
     *   LS = min member.ls
     *   LF = max member.lf
     *   slack = LS − ES
     *   criticality = max member.criticality (when MC is on)
     * Each is `null` when no member has a non-null value (e.g. all-TBD group).
     */
    es: number | null;
    ef: number | null;
    ls: number | null;
    lf: number | null;
    slack: number | null;
    criticality: number | null;
}
/**
 * Bare shape for a Monte-Carlo simulation result; Phase 2 fills it.
 * Keeping the shape exported in v1 means analyzer consumers don't break
 * when MC support lands.
 */
interface MonteCarloResult {
    /** Trials run (canonical or fast). */
    trials: number;
    /** Seed used for deterministic reproduction. */
    seed: number;
    /** Project-completion percentiles. */
    p50: number;
    p80: number;
    p95: number;
    /**
     * Central ~68% band — empirical equivalent of a ±1σ window. Used by
     * the S-curve to draw a "where the project most likely lands" shaded
     * region without assuming the finish-time distribution is normal.
     */
    p16: number;
    p84: number;
    /**
     * Empirical lower bound — minimum trial duration in canonical days.
     * Used by the S-curve to anchor its x-axis at the actually-observed
     * span rather than an analytical extrapolation. Backward-mode reads
     * this through `end_date − max` to land the left edge of the
     * candidate-start axis.
     */
    minDurationDays: number;
    /**
     * Empirical upper bound — maximum trial duration in canonical days.
     * Symmetric counterpart to `minDurationDays`. Backward-mode reads
     * this as the latest candidate start that still has a chance of
     * hitting the deadline.
     */
    maxDurationDays: number;
    /** Per-activity criticality index, keyed by activity id. */
    criticalityByActivity: Record<string, number>;
    /** Modal-longest-path tuple (activity ids). */
    modalCriticalPath: string[];
    /**
     * Per-activity tornado swings — how much the project end-date
     * moves when this activity comes in at its optimistic (O) or
     * pessimistic (P) extreme while every other activity stays at
     * its mean (μ). Sorted descending by total swing.
     *
     * `lowSwing` and `highSwing` are in canonical days (≥ 0).
     * Renderer converts to display unit.
     */
    tornadoSwings: TornadoSwing[];
}
/**
 * One row of a true two-sided tornado: the project end-date moves
 * lowSwing days earlier when the activity is at its optimistic
 * extreme, and highSwing days later when at its pessimistic extreme.
 * All other activities held at their μ.
 */
interface TornadoSwing {
    id: string;
    name: string;
    /** Days the project finishes EARLIER when this activity ≈ O. */
    lowSwing: number;
    /** Days the project finishes LATER when this activity ≈ P. */
    highSwing: number;
    /** Per-activity MC criticality index, used by the renderer for bar color. */
    criticality: number | null;
}
/**
 * Per-activity (O, M, P) in canonical days — the analyzer's
 * expanded-estimate cache, populated for every activity that has an
 * estimate (TBDs are omitted). Workers re-running Monte Carlo on an
 * already-resolved PERT can read this directly instead of re-parsing
 * + re-expanding from source.
 */
interface PertExpandedActivity {
    id: string;
    o: number;
    m: number;
    p: number;
}
interface ResolvedPert {
    options: PertOptions;
    activities: ResolvedActivity[];
    edges: PertEdge[];
    groups: ResolvedGroup[];
    /**
     * Tag groups copied from the parsed source. The renderer reads this
     * + `options.activeTag` to drive node fill via `resolveTagColor()`
     * and to render the legend.
     */
    tagGroups: TagGroup[];
    /**
     * Analysis mode auto-derived from data: `monte-carlo` when at least
     * one non-milestone activity carries an O/M/P triple AND `trials >= 100`,
     * otherwise `analytical`.
     */
    mode: 'monte-carlo' | 'analytical';
    /**
     * Project-stats caption rows. Each row is one bullet in the rendered
     * caption box; level-1 rows render indented under the preceding
     * level-0 row. Null only when analysis bails out before producing
     * any output (e.g. cycle detection); non-null in every successful
     * analyze() run.
     */
    summaryRows: CaptionRow[] | null;
    /**
     * One-line project summary rendered as a subtitle under the diagram title.
     * Shape per mode (see §13A.7):
     *   - Forward:    `Expected finish: <date> · ≈ <μ> <unit> of work (± <σ>)`
     *   - Backward:   `Expected start: <date> · ≈ <μ> <unit> lead time (± <σ>)`
     *   - Unanchored: `≈ <μ> <unit> (± <σ>)`
     * Null when analysis bails out before producing any output.
     */
    projectSubtitle: string | null;
    /** μ along the M-world critical path (max EF over all activities). */
    projectMu: number | null;
    /** σ along the M-world critical path (sqrt of variance sum). */
    projectSigma: number | null;
    /** Critical-path activity ids in topological order. */
    criticalPath: string[];
    /**
     * Anchored mode: the date all four schedule labels (ES/EF/LS/LF) are
     * computed off. Forward = start-date; backward = end-date − projectMu;
     * null otherwise (no anchor, or backward + TBD upstream).
     */
    projectStart: string | null;
    /** Populated when `mode === 'monte-carlo'`. */
    monteCarloResult: MonteCarloResult | null;
    /**
     * Per-activity (O, M, P) in canonical days. Always populated; used
     * by Phase 3b Worker / scrubber so the simulator can re-run on a
     * postMessage-cloned ResolvedPert without needing the original
     * ParsedPert or analyzer state.
     */
    expandedActivities: PertExpandedActivity[];
    diagnostics: DgmoError[];
    error: string | null;
}
interface PertLayoutNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
interface PertLayoutEdge {
    source: string;
    target: string;
    points: {
        x: number;
        y: number;
    }[];
}
interface PertLayoutGroup {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    classification: 'hammock' | 'cluster';
    /**
     * True when the group is currently collapsed. Layout sized this rect
     * as a single rolled-up node and hid the group's member activities
     * from `nodes` / re-routed external edges to land on this rect.
     */
    collapsed?: boolean;
}
interface LayoutResult {
    nodes: PertLayoutNode[];
    edges: PertLayoutEdge[];
    groups: PertLayoutGroup[];
    width: number;
    height: number;
}

/**
 * mulberry32: 32-bit seedable PRNG. Portable, deterministic, ~10 lines.
 * Returns a function that yields [0, 1).
 */
declare function mulberry32(seed: number): () => number;
/**
 * Sample one duration from a Beta-PERT distribution defined by (O, M, P).
 * Zero-variance case (O = M = P) bypasses sampling deterministically.
 */
declare function sampleBetaPert(o: number, m: number, p: number, rng: () => number): number;
interface ExpandedActivity {
    id: string;
    o: number;
    m: number;
    p: number;
}
interface SimulateOptions {
    trials: number;
    seed: number;
}
/**
 * Build a runnable simulation context from a `ResolvedPert`. The
 * analyzer will call this then invoke `simulateCanonical` /
 * `simulateFast` on the result.
 */
declare function buildSimulationContext(resolved: ResolvedPert): {
    predecessors: Map<string, string[]>;
    successors: Map<string, string[]>;
    topo: string[];
    terminals: string[];
    poisoned: Set<string>;
};
/**
 * Canonical simulation — N=10000 by default. Used for static export
 * and the "computing…" Worker job in the app.
 */
declare function simulateCanonical(resolved: ResolvedPert, expanded: ExpandedActivity[], opts: SimulateOptions): MonteCarloResult;
/**
 * Fast simulation — N=300 by default. Used by the duration scrubber for
 * sub-100ms re-analysis on each rAF tick.
 */
declare function simulateFast(resolved: ResolvedPert, expanded: ExpandedActivity[], opts: SimulateOptions): MonteCarloResult;

export { type ExpandedActivity, type LayoutResult, type MonteCarloResult, type NodeDetail, type ParsedPert, type PertActivity, type PertDirection, type PertEdge, type PertExpandedActivity, type PertGroup, type PertLayoutEdge, type PertLayoutGroup, type PertLayoutNode, type PertMilestone, type PertOptions, type ResolvedActivity, type ResolvedGroup, type ResolvedPert, type SimulateOptions, buildSimulationContext, mulberry32, sampleBetaPert, simulateCanonical, simulateFast };
