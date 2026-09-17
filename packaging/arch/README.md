# Packaging `dgmo` for Arch and Omarchy

`PKGBUILD` here builds `@diagrammo/dgmo-cli` into a pacman package. It has three
consumers and all three are real — do not tailor it to one.

## 1. Our own pacman repository — the route with upgrades

The `arch-repo` release on this repo **is** the repository: its assets are the
package, the database and their signatures, replaced in place on every publish.
`.github/workflows/arch-repo.yml` builds and publishes them.

```bash
# /etc/pacman.conf
[diagrammo]
Server = https://github.com/diagrammo/dgmo/releases/download/arch-repo
```

```bash
sudo pacman -Sy dgmo
```

After that `dgmo` upgrades with `pacman -Syu` alongside everything else on the
machine, which is the whole reason this route exists — routes 2 and 3 below give
you an install and nothing after it.

🔴 **The channel does not follow a release on its own — something has to
dispatch `arch-repo.yml`.** It is `workflow_dispatch` only: no tag trigger, no
release trigger. Since 2026-09-17 `scripts/release.sh dgmo-cli X.Y.Z` does it as
step 9, after it has confirmed npm serves the version. Releasing any other way
means dispatching it yourself, or the channel keeps serving the previous version
while `pacman -Syu` reports success and installs nothing:

```bash
gh workflow run arch-repo.yml -R diagrammo/dgmo -f version=X.Y.Z
```

🔴 **pacman follows GitHub's asset redirect, and that is measured rather than
assumed.** On Arch, 2026-09-17: `pacman -Sy` fetched `diagrammo.db` through the
302 to `objects.githubusercontent.com`, `pacman -Sp dgmo` resolved the package to
its asset URL, and `pacman -Sw dgmo` downloaded it byte-identically to what was
uploaded (sha256 `55a41505…`). So no bucket, no custom domain and no publish
credential beyond `GITHUB_TOKEN` are needed to serve a pacman repository.

🔴 **`repo-add` leaves `diagrammo.db` a SYMLINK to `diagrammo.db.tar.gz`, and a
GitHub release asset is a flat file** — upload the symlink and you publish its
19-byte target path as the database. pacman requests `<repo>.db`, so both names
have to be uploaded as real files with the same bytes. Same for `.files`, and
for the `.sig` beside each.

### Signing, and what it costs a user if we skip it

🔴 **On Omarchy an unsigned repository is REFUSED by default.**
`/etc/pacman.conf` there sets `SigLevel = Required DatabaseOptional` globally
(verified on Omarchy 4.0.4, 2026-09-17), and a `[diagrammo]` stanza with no
`SigLevel` of its own inherits it — so an unsigned package is a fatal error, not
a warning. Skipping signing therefore does not merely weaken the channel, it
forces every user to write `SigLevel = Optional TrustAll` into the stanza, which
is precisely the thing that makes a third-party repository look untrustworthy.

Signed, the stanza stays the two lines above and the user imports the key once:

```bash
curl -LO https://github.com/diagrammo/dgmo/releases/download/arch-repo/diagrammo.gpg
sudo pacman-key --add diagrammo.gpg
sudo pacman-key --lsign-key 17D65ED4FC456B0FA77BD83F21886645BC5F2431
```

🔴 **`pacman-key --recv-keys` does NOT work for this key and never will.** The
public half ships as the `diagrammo.gpg` release asset, not to a keyserver.
Arch's `/etc/pacman.d/gnupg/gpg.conf` carries three `keyserver-options` lines and
no `keyserver` line at all (re-verified on anchor, Omarchy 4.0.4, 2026-09-17), so
`--recv-keys` has nowhere to go and fails with "No keyserver available". Serving
the key beside the database keeps the whole channel on one host and needs no
third party.

✅ **The channel has been signed since 2026-09-17.** The key is
`17D65ED4FC456B0FA77BD83F21886645BC5F2431` (`Diagrammo LLC
<hello@diagrammo.app>`, rsa4096, sign+certify, no expiry). Verified that day on
anchor against the published bytes rather than the run log: `gpg --verify
diagrammo.db.sig diagrammo.db` gave a good signature, and `pacman -Sy dgmo`
recorded `Validated By: SHA-256 Sum  Signature` under Omarchy's stock
`SigLevel = Required DatabaseOptional`.

The workflow signs when the `ARCH_SIGNING_KEY` secret is set on this repo and
publishes unsigned with a loud warning when it is not, rather than failing and
leaving the channel with nothing.

### Omarchy overwrites `/etc/pacman.conf`, so the stanza needs a hook

🔴 `omarchy-refresh-pacman` does `sudo cp -f "$OMARCHY_PATH/default/pacman/pacman-$channel.conf" /etc/pacman.conf`
— it replaces the **whole file** with Omarchy's default on every channel
refresh, and a hand-added stanza does not survive it. It then calls
`omarchy-hook pre-refresh-pacman` for exactly this reason, before running
`pacman -Syyuu`. So the instruction is always "add the stanza **and** the hook",
never just the stanza:

```bash
mkdir -p ~/.config/omarchy/hooks/pre-refresh-pacman.d
command cat > ~/.config/omarchy/hooks/pre-refresh-pacman.d/10-diagrammo <<'HOOK'
grep -q '^\[diagrammo\]' /etc/pacman.conf || sudo tee -a /etc/pacman.conf >/dev/null <<'STANZA'

[diagrammo]
Server = https://github.com/diagrammo/dgmo/releases/download/arch-repo
STANZA
HOOK
```

`omarchy-hook` runs `~/.config/omarchy/hooks/<name>` and every file in
`<name>.d/`, skipping `*.sample`. Read off `/usr/bin/omarchy-hook` and
`/usr/bin/omarchy-refresh-pacman` on Omarchy 4.0.4, 2026-09-17.

## 2. Building it yourself, with nothing hosted by us

Arch ships `base-devel`, so `makepkg` is already there on a stock install:

```bash
git clone https://github.com/diagrammo/dgmo.git
cd dgmo/packaging/arch
makepkg -si
```

No repository, no signing key, no account with anybody. `dgmo --version`
afterwards should match the `pkgver` in the PKGBUILD.

To install a package file someone has already built:

```bash
curl -LO https://…/dgmo-<version>-1-x86_64.pkg.tar.zst
sudo pacman -U ./dgmo-<version>-1-x86_64.pkg.tar.zst
```

🔴 **Download first, then install — a one-liner will fail on Omarchy.** `pacman -U`
accepts a URL, but `RemoteFileSigLevel` is unset in Omarchy's `/etc/pacman.conf`,
so it inherits `SigLevel = Required`, under which "absence of a signature … is a
fatal error". `pacman -U https://…` on an unsigned package is refused; the same
file installs cleanly once on disk, because Omarchy sets
`LocalFileSigLevel = Optional`. The error names neither the policy nor the
setting, so it reads as a corrupt package. Verified on anchor 2026-09-17.

⚠️ **A package installed this way is foreign** (`pacman -Qm` lists it), so
`pacman -Syu` leaves it alone. There are no automatic updates on this route.
Installing from route 1 afterwards adopts it — same package name, so pacman
upgrades rather than conflicts.

## 3. Omarchy's package repository

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

⚠️ **Nothing has been offered to them, and that is deliberate** (2026-09-17). The
owner wants the package exercised on his own machines through route 1 first. Do
not open anything on `omacom/omarchy-pkgs` without being told to.

## Two CLI defects, fixed 2026-09-17 — do not offer a package built before that

Both bit exactly when `dgmo` is installed by a package manager, and both are
fixed in `dgmo` commit `fcf915bf`:

- **`isHomebrewManaged()` did not detect a package-manager-owned install**, so
  `dgmo install` fell through to `npm install -g @diagrammo/dgmo-mcp@latest` —
  which under a `/usr` prefix needs root and writes outside pacman's database.
  It is now `owningPackageManager()` in `src/cli-host.ts`, which answers
  `homebrew`, `system` or `null`, and both owned cases skip the install.
- **Clipboard copy shelled out to `xclip`.** Omarchy is Hyprland/Wayland and
  ships `wl-copy`, so copying failed silently. `linuxClipboardCommand()` picks on
  the session rather than on mere presence.

✅ **Both fixes are released and this recipe carries them**, as of
`@diagrammo/dgmo-cli` 0.86.0 (published 2026-09-17, the first version above
`fcf915bf`). `pkgver` and `sha256sums` above point at that tarball, so a
`makepkg -si` from a clone builds a CLI that knows pacman owns it.

## What the sha256 does and does not pin

The published npm tarball is the CLI bundle only — 30 files, no `node_modules` —
so `package()` resolves `@diagrammo/dgmo-mcp`, `jsdom` and `@resvg/resvg-js` from
the registry at build time. The checksum pins what we publish, not the dependency
tree. The Homebrew formula makes the same trade. Publishing a tarball that
bundles its dependencies would remove it, and is a change to how we publish
rather than to this recipe.
