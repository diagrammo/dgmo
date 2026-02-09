#!/usr/bin/env bash
# Quick build-and-test loop for the dgmo CLI.
# Usage: ./test-cli.sh <input.dgmo> [extra args...]
# Example: ./test-cli.sh /tmp/foo.dgmo --theme dark --palette bold

set -e

cd "$(dirname "$0")"
pnpm build --silent 2>/dev/null

node dist/cli.cjs "$@"
