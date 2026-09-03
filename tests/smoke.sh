#!/usr/bin/env bash
# End-to-end smoke test: build, run the unit/integration suite, then run the
# offline demo pipeline. This is what CI runs on every push.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

echo "==> node --test"
node --test dist/tests/*.test.js

echo "==> mole run --demo"
node bin/mole.js run --demo

echo "==> mole run --demo --write-tests"
node bin/mole.js run --demo --write-tests

echo "==> mole run --demo --json"
node bin/mole.js run --demo --json > /dev/null

echo "smoke test passed."
