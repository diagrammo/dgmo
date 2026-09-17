# Packaging `dgmo` for Arch and Omarchy

`PKGBUILD` here builds `@diagrammo/dgmo-cli` into a pacman package. It has two
consumers and both are real — do not tailor it to one.

## 1. A user installing it today, with nothing hosted by us

Arch ships `base-devel`, so `makepkg` is already there on a stock install:

```bash
git clone https://github.com/diagrammo/dgmo.git
cd dgmo/packaging/arch
makepkg -si
```

That is the whole route. No AUR entry, no repository, no signing key, no account
with anybody. `dgmo --version` afterwards should match the `pkgver` in the
PKGBUILD.

To install a package file someone has already built:

```bash
curl -LO https://…/dgmo-0.85.0-1-x86_64.pkg.tar.zst
sudo pacman -U ./dgmo-0.85.0-1-x86_64.pkg.tar.zst
```

🔴 **Download first, then install — a one-liner will fail on Omarchy.** `pacman -U`
accepts a URL, but `RemoteFileSigLevel` is unset in Omarchy's `/etc/pacman.conf`,
so it inherits `SigLevel = Required`, under which "absence of a signature … is a
fatal error". `pacman -U https://…` on an unsigned package is refused; the same
file installs cleanly once on disk, because Omarchy sets
`LocalFileSigLevel = Optional`. The error names neither the policy nor the
setting, so it reads as a corrupt package. Verified on anchor 2026-09-17.

A package installed this way is foreign (`pacman -Qm` lists it), so `pacman -Syu`
leaves it alone. There are no automatic updates on this route, and no conflict
either.

## 2. Omarchy's package repository

Omarchy serves `pkgs.omarchy.org` from `omacom/omarchy-pkgs`, where a package is
`pkgbuilds/<name>/PKGBUILD` plus `.omarchy/package.json` — the same two files in
this directory, which is why the layout here mirrors theirs exactly.

🔴 **Omarchy stopped syncing from the AUR on 2026-09-15**
(`omacom/omarchy-pkgs#445`, _Replace AUR sync with direct upstream release
watches_). All 68 previously-synced AUR packages became Omarchy-owned recipes on
direct vendor watches, and the scheduled AUR workflow was retired. An AUR-only
package therefore reaches no Omarchy machine by default — on a stock Omarchy
4.0.4 install, `pacman -Qm` returns **0** of 966 packages. Do not restore an AUR
route on the belief that it feeds theirs.

`.omarchy/package.json` declares an `npm` upstream watch, so once accepted their
pipeline follows `@diagrammo/dgmo-cli` releases and does the version bumps.
Nothing on our side has to push a bump, which is the main reason this channel is
worth more than one we host ourselves.

`release_ring` is deliberately **not** set: a package without one builds for
`edge` only, which is the modest default for a package they have not asked for.
Their maintainers can promote it.

## Known gaps, before this is offered to anyone

These are defects in the CLI rather than in the recipe, and both bite exactly
when `dgmo` is installed by a package manager:

- **`isHomebrewManaged()` (`src/cli.ts`) does not detect a pacman-owned
  install.** `dgmo install` therefore falls through to
  `npm install -g @diagrammo/dgmo-mcp@latest`, which under a `/usr` prefix needs
  root and writes outside the package manager. The MCP server is already an
  ordinary dependency of this package and is present at an absolute path, so the
  install is not merely unnecessary — it is wrong.
- **Clipboard copy shells out to `xclip`** (`src/cli.ts`). Omarchy is
  Hyprland/Wayland and ships `wl-copy`, not `xclip`, so copying fails silently
  there today — the call is `try`/`catch`-wrapped and returns `false`.

## What the sha256 does and does not pin

The published npm tarball is the CLI bundle only — 30 files, no `node_modules` —
so `package()` resolves `@diagrammo/dgmo-mcp`, `jsdom` and `@resvg/resvg-js` from
the registry at build time. The checksum pins what we publish, not the dependency
tree. The Homebrew formula makes the same trade. Publishing a tarball that
bundles its dependencies would remove it, and is a change to how we publish
rather than to this recipe.
