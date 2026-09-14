#!/usr/bin/env bash
# stale-ref-check.sh — refuse, in seconds, a push that has already lost the
# race for its ref (#680).
#
# Usage, from .githooks/pre-push with git's pre-push stdin piped in:
#   printf '%s\n' "$refs" | bash .githooks/stale-ref-check.sh <remote> <when>
#
# Git hands pre-push "<local ref> <local sha> <remote ref> <remote sha>" per
# ref, and <remote sha> is what the remote held when the push began. The
# remote refuses the update unless it STILL holds exactly that sha —
# `! [remote rejected] … cannot lock ref 'refs/heads/main': is at X but
# expected Y`. Measured 2026-09-03/04: five attempts on one change, four of
# them refused that way, each AFTER a green gate and a queue of 8 to 20
# minutes behind the gate lock. The change was never wrong; it lost the ref
# while it waited.
#
# So the hook asks the remote where the ref is now, once before it queues for
# the lock and once right after it gets it — the queue is where the ref goes
# stale. A ref that has moved is refused here, with the fix, instead of after
# the gate.
#
# 🔴 It never retries on its own. Rebasing inside the hook would gate a tree
# the person never looked at, and would loop under contention.
#
# 🔴 It never blocks on the network. A remote that cannot be asked — offline,
# slow, auth — degrades to what the hook did before this existed, and says so.
#
# Exit 0: every pushed ref's remote tip is what this push expects, or the
#         remote could not be asked.
# Exit 1: at least one pushed ref has moved on the remote.

set -u

remote=${1:-origin}
when=${2:-}
ZERO=0000000000000000000000000000000000000000
TIMEOUT_S=${STALE_REF_CHECK_TIMEOUT:-20}

ask() {
  if command -v timeout >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 timeout "$TIMEOUT_S" git ls-remote "$remote" "$1"
  else
    GIT_TERMINAL_PROMPT=0 git ls-remote "$remote" "$1"
  fi
}

stale=0
while read -r _lref lsha rref rsha; do
  [ -z "${lsha:-}" ] && continue
  [ "$lsha" = "$ZERO" ] && continue # a deletion expects nothing
  if ! out=$(ask "$rref" 2>/dev/null); then
    echo "pre-push: could not ask $remote where $rref is ($when) — carrying on unchecked"
    continue
  fi
  tip=$(printf '%s\n' "$out" | awk -v r="$rref" '$2 == r { print $1; exit }')
  [ -n "$tip" ] || tip=$ZERO # not on the remote (yet)
  if [ "$tip" != "$rsha" ]; then
    echo "pre-push: $rref on $remote moved while this push waited ($when): it is at ${tip:0:8}, this push expects ${rsha:0:8}."
    echo "pre-push: the remote would refuse it after the gate anyway — rebase onto $remote/${rref#refs/heads/} and push again."
    stale=1
  fi
done

exit "$stale"
