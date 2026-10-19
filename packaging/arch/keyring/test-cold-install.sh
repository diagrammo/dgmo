#!/bin/bash
#
# Cold-install test of the published [diagrammo] channel: a clean `archlinux`
# container that has never joined runs the README's Arch one-liner, then checks
# what the keyring package promises. Needs docker and the network.
#
#   ./test-cold-install.sh [image]        # default archlinux:latest
#
# 🔴 It tests what the channel SERVES, not this checkout's PKGBUILDs — the
# keyring and dgmo come from the `arch-repo` release. Only the one-liner is read
# from this checkout: the `# Arch` block of README.md §1, so a README edit that
# breaks the line breaks this test.
#
# Not covered: Omarchy. Its update guard and `omarchy-refresh-pacman` do not
# exist in a container, so the Omarchy `-Sy` line is not run here.
set -uo pipefail
IMAGE=${1:-archlinux:latest}
README=$(dirname "$0")/../README.md

# The first `# Arch` block: from that comment to the next blank line.
LINE=$(awk '/^# Arch$/ {on=1; next} on && /^$/ {exit} on' "$README")
[ -n "$LINE" ] || { echo "FAIL  no '# Arch' block in $README"; exit 1; }
echo "one-liner from README.md:"
echo "$LINE" | sed 's/^/  /'

docker run --rm -i -e LINE="$LINE" "$IMAGE" bash -s <<'EOF'
set -uo pipefail
fail=0
ok() { echo "  PASS  $1"; }
no() { echo "  FAIL  $1"; fail=1; }

# What a fresh install has: an initialised keyring with Arch's keys, no synced
# databases. The image has no sudo and runs as root, so sudo is a pass-through
# shim — installing the real one would sync the databases first.
pacman-key --init >/dev/null 2>&1 && pacman-key --populate archlinux >/dev/null 2>&1
printf '#!/bin/sh\nexec "$@"\n' > /usr/local/bin/sudo && chmod +x /usr/local/bin/sudo
cd "$(mktemp -d)"

# pacman asks before each transaction; `yes` answers as a user would. Fed by
# process substitution, not a pipe: under pipefail `yes` dies of SIGPIPE and
# the pipe reports 141 for a line that succeeded.
if bash -c "$LINE" < <(yes) > install.log 2>&1; then ok "the one-liner installs"
else no "the one-liner installs"; tail -20 install.log; fi

v=$(dgmo --version 2>&1) && ok "dgmo --version prints $v" || no "dgmo --version: $v"
printf 'flowchart\nA -> B\n' > t.dgmo
dgmo t.dgmo -o t.svg >/dev/null 2>&1 && grep -q '<svg' t.svg \
  && ok "dgmo renders a flowchart to SVG" || no "dgmo renders a flowchart to SVG"

pacman-key --list-keys 17D65ED4FC456B0FA77BD83F21886645BC5F2431 >/dev/null 2>&1 \
  && ok "the signing key is in pacman's keyring" || no "the signing key is in pacman's keyring"

# omarchy-refresh-pacman's shape: the whole file replaced by plain cp, then a
# transaction. The hook must put the stanza back.
awk '/^\[diagrammo\]$/ {skip=1; next} skip && /^(\[|$)/ {skip=0} !skip' \
  /etc/pacman.conf > /tmp/pacman.conf.fresh && cp /tmp/pacman.conf.fresh /etc/pacman.conf
grep -q '^\[diagrammo\]$' /etc/pacman.conf && no "stanza stripped for the hook case"
pacman -S --noconfirm --needed which >/dev/null 2>&1
grep -q '^\[diagrammo\]$' /etc/pacman.conf \
  && ok "the hook restores the stanza after pacman.conf is overwritten" \
  || no "the hook restores the stanza after pacman.conf is overwritten"

pacman -R --noconfirm diagrammo-keyring >/dev/null 2>&1 && ok "pacman -R diagrammo-keyring" \
  || no "pacman -R diagrammo-keyring"
grep -q '^\[diagrammo\]$' /etc/pacman.conf && no "removal leaves no stanza" || ok "removal leaves no stanza"
[ -e /usr/share/libalpm/hooks/10-diagrammo-repo.hook ] && no "removal leaves no hook" || ok "removal leaves no hook"
dgmo --version >/dev/null 2>&1 && ok "dgmo still runs once the channel is gone" \
  || no "dgmo still runs once the channel is gone"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "FAILED"
exit "$fail"
EOF
