/**
 * Compact view state schema (ADR-6).
 * All fields optional. Only non-default values are encoded.
 * `tag: null` means "user chose none"; absent `tag` means "use DSL default" (ADR-5).
 */
interface CompactViewState {
    tag?: string | null;
    cs?: number[];
    cg?: string[];
    swim?: string | null;
    cl?: string[];
    cc?: string[];
    rm?: string;
    htv?: Record<string, string[]>;
    ha?: string[];
    sem?: boolean;
    cm?: boolean;
    c4l?: string;
    c4s?: string;
    c4c?: string;
    rps?: number;
    spd?: number;
    io?: Record<string, number>;
    hd?: boolean;
    cbd?: boolean;
    rq?: string;
    an?: boolean;
    fl?: boolean;
}

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
declare function formatDgmoError(err: DgmoError): string;

/**
 * Parse DGMO content and return diagnostics without rendering.
 * Useful for the CLI and editor to surface all errors before attempting render.
 */
declare function parseDgmo(content: string): {
    diagnostics: DgmoError[];
    chartType: string | null;
};

/**
 * Color definitions for a single mode (light or dark).
 * 10 semantic UI colors + 9 named accent colors = 19 total.
 */
interface PaletteColors {
    /** Main background (#eceff4 light / #2e3440 dark for Nord) */
    bg: string;
    /** Cards, panels (#e5e9f0 / #3b4252) */
    surface: string;
    /** Popovers, dropdowns (#e5e9f0 / #434c5e) */
    overlay: string;
    /** Borders, dividers, muted (#d8dee9 / #4c566a) */
    border: string;
    /** Primary text (#2e3440 / #eceff4) */
    text: string;
    /** Secondary/diminished text (#4c566a / #d8dee9) */
    textMuted: string;
    /**
     * Light-mode arg for `contrastText()` when text is rendered on a
     * tinted shape fill (e.g. `shapeFill()` output). Must guarantee
     * ≥ 4.5:1 WCAG AA against any `shapeFill()` the palette can produce.
     * Distinct from `colors.white` because palette-aesthetic anchors don't
     * always meet contrast requirements (TD-5).
     */
    textOnFillLight: string;
    /** Dark-mode counterpart to `textOnFillLight`. */
    textOnFillDark: string;
    /** Primary accent — buttons, links */
    primary: string;
    /** Secondary accent */
    secondary: string;
    /** Tertiary accent */
    accent: string;
    /** Error/danger */
    destructive: string;
    /**
     * Used for: inline annotations (red), pie charts, cScale,
     * series rotation, journey actors, Gantt tasks.
     */
    colors: {
        red: string;
        orange: string;
        yellow: string;
        green: string;
        blue: string;
        purple: string;
        teal: string;
        cyan: string;
        gray: string;
        black: string;
        white: string;
    };
}
/**
 * Complete palette definition. One object per color scheme.
 * This is what palette authors create — the single artifact for NFR1.
 */
interface PaletteConfig {
    /** Registry key: 'nord', 'solarized', 'catppuccin' */
    id: string;
    /** Display name: 'Nord', 'Solarized', 'Catppuccin' */
    name: string;
    /** Light mode color definitions */
    light: PaletteColors;
    /** Dark mode color definitions */
    dark: PaletteColors;
}

/**
 * Theme — render mode flag. Selects which palette variant the renderer uses
 * for background and text:
 *  - 'light'       → palette.light colors
 *  - 'dark'        → palette.dark colors
 *  - 'transparent' → no background fill (for embedding in colored containers)
 */
type Theme = 'light' | 'dark' | 'transparent';
/**
 * `themes` namespace — use with render() options for a typed handle:
 *
 *   await render(text, { theme: themes.dark });
 *
 * Passing the raw string `'dark'` also works (the underlying type is the
 * string-literal union); the namespace is the conventional path.
 */
declare const themes: {
    readonly light: "light";
    readonly dark: "dark";
    readonly transparent: "transparent";
};

/** Get palette by id. Returns Nord if id is unrecognized (FR10). */
declare function getPalette(id: string): PaletteConfig;

/**
 * All built-in palettes, keyed by camelCase id. Use directly with render():
 *
 *   await render(text, { palette: palettes.catppuccin });
 *
 * For preference/settings storage, the `.id` field of each entry is the
 * canonical string (e.g. `'tokyo-night'`, `'nord'`) — that's the wire format
 * used by share URLs and the CLI `--palette` flag.
 */
declare const palettes: {
    readonly nord: PaletteConfig;
    readonly catppuccin: PaletteConfig;
    readonly solarized: PaletteConfig;
    readonly gruvbox: PaletteConfig;
    readonly tokyoNight: PaletteConfig;
    readonly oneDark: PaletteConfig;
    readonly rosePine: PaletteConfig;
    readonly dracula: PaletteConfig;
    readonly monokai: PaletteConfig;
    readonly bold: PaletteConfig;
};

interface RenderOptions {
    theme?: Theme;
    palette?: PaletteConfig;
    /**
     * How to handle parse errors:
     *   'svg'    — render an inline error SVG (default)
     *   'silent' — return empty svg + diagnostics; caller handles UI
     *   'throw'  — throw an Error with the diagnostics
     */
    onError?: 'svg' | 'silent' | 'throw';
    /**
     * Pre-applied interactive view state — collapsed sections/columns,
     * active swimlane tag-group, etc. Used to render a specific view
     * non-interactively (server-side render, share-link decode).
     */
    viewState?: CompactViewState;
}
interface RenderResult {
    svg: string;
    diagnostics: DgmoError[];
}
/**
 * Render DGMO source to an SVG string.
 *
 * @example
 * ```ts
 * import { render, palettes, themes } from '@diagrammo/dgmo';
 *
 * const { svg } = await render(text, {
 *   palette: palettes.catppuccin,
 *   theme: themes.dark,
 * });
 * document.getElementById('chart').innerHTML = svg;
 * ```
 */
declare function render(text: string, options?: RenderOptions): Promise<RenderResult>;

interface EncodeDiagramUrlOptions {
    baseUrl?: string;
    palette?: PaletteConfig;
    theme?: Theme;
    filename?: string;
    /**
     * Initial view state to embed in the URL — re-applied when the link is
     * decoded so recipients open the diagram in the same configuration.
     */
    viewState?: CompactViewState;
}
/**
 * Encode DGMO text into a shareable URL. Returns null if the compressed
 * payload exceeds the 8 KB URL limit.
 */
declare function encodeDiagramUrl(text: string, options?: EncodeDiagramUrlOptions): string | null;
interface DecodedDiagramUrl {
    text: string;
    palette?: PaletteConfig;
    theme?: Theme;
    filename?: string;
}
/**
 * Decode a share URL back into DGMO text plus optional palette/theme/filename.
 * Returns null if the URL contains no valid DGMO payload.
 */
declare function decodeDiagramUrl(url: string): DecodedDiagramUrl | null;

export { type CompactViewState, type DecodedDiagramUrl, type DgmoError, type DgmoSeverity, type EncodeDiagramUrlOptions, type PaletteColors, type PaletteConfig, type RenderOptions, type RenderResult, type Theme, decodeDiagramUrl, encodeDiagramUrl, formatDgmoError, getPalette, palettes, render, themes, parseDgmo as validate };
