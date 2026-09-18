#!/bin/bash
#
# Tests ensure-repo.sh. Runs anywhere — on Arch it uses this machine's real
# /etc/pacman.conf as the starting point, elsewhere a synthetic one.
#
#   ./test-ensure-repo.sh [path/to/ensure-repo.sh]
#
# Nothing here touches the real /etc/pacman.conf: every case runs against a copy
# in a temporary directory, through DIAGRAMMO_PACMAN_CONF.
#
# 🔴 Case 3 is the one that earns its keep. The first version of the removal awk
# buffered a blank line as text, and an awk variable holding a blank line holds
# the empty string — so it deleted every blank line in the file while cases 1,
# 2, 4, 5 and 6 all passed. Revert that and this must go red.
set -uo pipefail
S=${1:-$(dirname "$0")/ensure-repo.sh}
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
fail=0
ok() { echo "  PASS  $1"; }
no() { echo "  FAIL  $1"; fail=1; }

# The starting point is a config that has never joined. On Arch that is this
# machine's real /etc/pacman.conf with any [diagrammo] stanza stripped, which is
# the case worth testing; anywhere else it is the synthetic one below, so this
# runs on a developer's laptop too.
if [[ -f /etc/pacman.conf ]]; then
  awk '/^[[:space:]]*\[diagrammo\][[:space:]]*$/{d=1;next} d&&/^[[:space:]]*\[/{d=0} d{next} {print}' \
    /etc/pacman.conf > "$W/base.conf"
  echo "base: /etc/pacman.conf ($(grep -c "" "$W/base.conf") lines)"
else
  cat > "$W/base.conf" <<'CONF'
[options]
HoldPkg     = pacman glibc
Architecture = auto

# blank lines above and below this comment are load-bearing in the tests

SigLevel    = Required DatabaseOptional
LocalFileSigLevel = Optional

[core]
Include = /etc/pacman.d/mirrorlist

[extra]
Include = /etc/pacman.d/mirrorlist
CONF
  echo "base: synthetic ($(grep -c "" "$W/base.conf") lines) — no /etc/pacman.conf here"
fi
grep -q '^\[diagrammo\]' "$W/base.conf" && { echo "setup broken: stanza still present"; exit 1; }

run() { DIAGRAMMO_PACMAN_CONF="$1" bash "$S" "${2:-}" >"$W/out" 2>&1; echo $?; }

echo "1. add to a config that has never joined"
cp "$W/base.conf" "$W/a.conf"
rc=$(run "$W/a.conf")
[ "$rc" = 0 ] && grep -qE '^\[diagrammo\]$' "$W/a.conf" && ok "stanza added (exit $rc)" || no "add failed (exit $rc)"
grep -qE '^\[options\]$' "$W/a.conf" && ok "[options] intact" || no "[options] lost"
grep -A1 '^\[diagrammo\]$' "$W/a.conf" | grep -q '^Server = https://github.com/diagrammo/dgmo' && ok "Server line correct" || no "Server line wrong"

echo "2. adding again changes nothing"
cp "$W/a.conf" "$W/a.before"
rc=$(run "$W/a.conf")
[ "$rc" = 0 ] && cmp -s "$W/a.before" "$W/a.conf" && ok "byte-identical (exit $rc)" || no "second add modified the file"
[ -s "$W/out" ] && no "second add printed: $(cat "$W/out")" || ok "second add was silent"

echo "3. remove restores the original bytes"
rc=$(run "$W/a.conf" --remove)
[ "$rc" = 0 ] && cmp -s "$W/base.conf" "$W/a.conf" && ok "identical to never-joined (exit $rc)" || { no "remove left a different file (exit $rc)"; diff "$W/base.conf" "$W/a.conf" | head -6; }

echo "4. removing again is a no-op"
cp "$W/a.conf" "$W/a.before"
rc=$(run "$W/a.conf" --remove)
[ "$rc" = 0 ] && cmp -s "$W/a.before" "$W/a.conf" && ok "byte-identical (exit $rc)" || no "second remove modified the file"

echo "5. a section AFTER ours survives removal"
cp "$W/base.conf" "$W/b.conf"
printf '\n[diagrammo]\nServer = https://example.invalid\n\n[extra]\nServer = https://elsewhere.invalid\n' >> "$W/b.conf"
rc=$(run "$W/b.conf" --remove)
grep -qE '^\[extra\]$' "$W/b.conf" && ok "[extra] survived (exit $rc)" || no "[extra] was eaten"
grep -q 'elsewhere.invalid' "$W/b.conf" && ok "its Server survived" || no "its Server was eaten"
grep -q '^\[diagrammo\]' "$W/b.conf" && no "ours survived" || ok "ours removed"

echo "6. a hand-written stanza with leading whitespace is still found"
cp "$W/base.conf" "$W/c.conf"
printf '\n  [diagrammo]\nServer = https://example.invalid\n' >> "$W/c.conf"
rc=$(run "$W/c.conf")
[ "$(grep -c 'diagrammo' "$W/c.conf")" -le 2 ] && ok "no duplicate stanza added (exit $rc)" || no "added a second stanza beside the indented one"

echo
[ $fail = 0 ] && echo "ALL PASSED" || echo "FAILURES ABOVE"
exit $fail
