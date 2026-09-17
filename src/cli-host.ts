// How this CLI sits on the host machine: which package manager owns the install,
// and which clipboard tool the session actually has.
//
// Both are pure functions of their arguments so a test can drive them without a
// real machine. They live here rather than in cli.ts because that module calls
// `main()` at import time, so nothing inside it can be imported by a test.

/** The package manager that owns this install, or null when nothing does. */
export type OwningPackageManager = 'homebrew' | 'system' | null;

// A distribution package — the Arch recipe in `packaging/arch/`, and anything
// shaped like it — installs into a root-owned prefix, and every file under it
// belongs to that package manager's database. Homebrew's Cellar is the same
// situation with a different prefix.
//
// `/usr/local/lib/node_modules` is deliberately absent: that is a plain
// `npm install -g`, which no package manager owns and which upgrades the normal
// way.
const SYSTEM_PREFIXES = [
  '/usr/lib/node_modules/',
  '/usr/lib64/node_modules/',
  '/usr/share/node_modules/',
];

// Decided from where this CLI's own files sit, because that is the one thing
// true of every packaging route and knowable without probing for a package
// manager that may not be installed.
export function owningPackageManager(pkgRoot: string): OwningPackageManager {
  if (pkgRoot.includes('/Cellar/') || pkgRoot.includes('/homebrew/')) {
    return 'homebrew';
  }
  if (SYSTEM_PREFIXES.some((prefix) => pkgRoot.includes(prefix))) {
    return 'system';
  }
  return null;
}

// The clipboard command for a Linux session, or null when neither tool is
// installed.
//
// Wayland compositors ship wl-clipboard and no xclip — Omarchy, the
// distribution our own Arch package targets, is Hyprland and has exactly that
// shape, so a copy there hit `xclip` and failed silently. X11 boxes are the
// other way round, and a box can carry both, so the session decides rather than
// mere presence: WAYLAND_DISPLAY is set by the compositor and by nothing else.
export function linuxClipboardCommand(
  commandExists: (cmd: string) => boolean,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env['WAYLAND_DISPLAY'] && commandExists('wl-copy')) return 'wl-copy';
  if (commandExists('xclip')) return 'xclip -selection clipboard';
  if (commandExists('wl-copy')) return 'wl-copy';
  return null;
}
