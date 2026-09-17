import { describe, it, expect } from 'vitest';
import { owningPackageManager, linuxClipboardCommand } from '../src/cli-host';

// A stub for `commandExists`, so these run the same on a machine with neither
// clipboard tool installed as on one with both.
const has =
  (...present: string[]) =>
  (cmd: string) =>
    present.includes(cmd);

describe('owningPackageManager', () => {
  it('recognises a Homebrew install on macOS', () => {
    expect(
      owningPackageManager(
        '/opt/homebrew/Cellar/dgmo/0.85.0/libexec/lib/node_modules/@diagrammo/dgmo-cli'
      )
    ).toBe('homebrew');
  });

  // Homebrew on Linux keeps the same Cellar layout under its own prefix, which
  // is what the `/Cellar/` case matches — the bare `/home/linuxbrew/.linuxbrew`
  // prefix never holds the package itself.
  it('recognises a Homebrew install on Linux', () => {
    expect(
      owningPackageManager(
        '/home/linuxbrew/.linuxbrew/Cellar/dgmo/0.85.0/libexec/lib/node_modules/@diagrammo/dgmo-cli'
      )
    ).toBe('homebrew');
  });

  // The pacman layout our own packaging/arch/PKGBUILD produces. This is the
  // case that used to fall through and run `npm install -g` against a /usr
  // prefix — root-owned, and outside the package manager's database.
  it('recognises a distribution package at a /usr prefix', () => {
    expect(
      owningPackageManager('/usr/lib/node_modules/@diagrammo/dgmo-cli')
    ).toBe('system');
    expect(
      owningPackageManager('/usr/lib64/node_modules/@diagrammo/dgmo-cli')
    ).toBe('system');
  });

  // A plain `npm install -g`: nothing owns it, so `dgmo install` must keep
  // installing and upgrading the MCP server itself.
  it('leaves an ordinary npm global install unowned', () => {
    expect(
      owningPackageManager('/usr/local/lib/node_modules/@diagrammo/dgmo-cli')
    ).toBeNull();
    expect(
      owningPackageManager(
        '/home/demian/.local/share/mise/installs/node/26.7.0/lib/node_modules/@diagrammo/dgmo-cli'
      )
    ).toBeNull();
    expect(
      owningPackageManager('/Users/demian/code/diagrammo/dgmo')
    ).toBeNull();
  });
});

describe('linuxClipboardCommand', () => {
  // Omarchy — the distribution packaging/arch targets — is Hyprland, ships
  // wl-clipboard and has no xclip. This is the case that failed silently.
  it('uses wl-copy in a Wayland session', () => {
    expect(
      linuxClipboardCommand(has('wl-copy'), { WAYLAND_DISPLAY: 'wayland-1' })
    ).toBe('wl-copy');
  });

  it('uses xclip on X11', () => {
    expect(linuxClipboardCommand(has('xclip'), { DISPLAY: ':0' })).toBe(
      'xclip -selection clipboard'
    );
  });

  // Both installed: the session decides, not mere presence, because xclip on a
  // Wayland session talks to an XWayland clipboard the compositor's own apps
  // do not read.
  it('prefers the tool matching the session when both are installed', () => {
    expect(
      linuxClipboardCommand(has('wl-copy', 'xclip'), {
        WAYLAND_DISPLAY: 'wayland-1',
      })
    ).toBe('wl-copy');
    expect(
      linuxClipboardCommand(has('wl-copy', 'xclip'), { DISPLAY: ':0' })
    ).toBe('xclip -selection clipboard');
  });

  // A bare TTY or an ssh session has neither variable set; the tool that is
  // there is still better than giving up.
  it('falls back to whichever tool exists when the session says nothing', () => {
    expect(linuxClipboardCommand(has('wl-copy'), {})).toBe('wl-copy');
    expect(linuxClipboardCommand(has('xclip'), {})).toBe(
      'xclip -selection clipboard'
    );
  });

  it('returns null when neither tool is installed', () => {
    expect(
      linuxClipboardCommand(has(), { WAYLAND_DISPLAY: 'wayland-1' })
    ).toBeNull();
  });
});
