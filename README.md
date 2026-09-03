# mole

*An adversary for your test suite. It plants plausible bugs and tells you which ones you would have shipped.*

[![tests](https://github.com/defi0x1/mole/actions/workflows/test.yml/badge.svg)](https://github.com/defi0x1/mole/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

mole asks a coding-agent CLI to introduce a bug into one of your source
files — the kind a tired engineer would actually write, not a syntax
mutation — applies it in an isolated git worktree, and runs your test suite
against it. If the suite stays green, the bug escaped. mole reports which
bugs it planted, which ones you caught, and which ones you would have
shipped.

## What it looks like

```
$ mole run --demo
running baseline suite...

ESCAPE REPORT · Sep 3, 2026 · src/cart.js

  10 planted · 5 escaped · escape rate 50%

  ✗ ESCAPED  cart.js:6   off-by-one on the discount upper bound, rejects a full 100% discount
             your suite was green with this in place
  ✗ ESCAPED  cart.js:12   tax rounds to three decimals instead of two, drifts on odd cents
  ✗ ESCAPED  cart.js:21   tie-break on equal prices silently picks the later item
  ✗ ESCAPED  cart.js:20   single-item carts report no most-expensive item
  ✗ ESCAPED  cart.js:21   total floors instead of rounding, loses a cent on odd totals
  ✓ caught   ×5

  0 invalid (patch did not apply) · 0 flaky
```

That is real output from `mole run --demo` against the tiny fixture project
shipped in this repo — no network, no API key, nothing to configure.

## Install

mole is not published to npm. Clone and link it:

```
git clone https://github.com/defi0x1/mole.git
cd mole
npm install
npm run build
npm link
```

`npm link` puts a `mole` binary on your PATH pointing at this checkout.

## Quickstart

```
mole run --demo
mole init
mole run --write-tests
```

The first command needs nothing from your project — it runs the full
pipeline against a bundled fixture and proves mole works before you point it
at real code. The second detects your test command and writes `mole.json`.
The third plants bugs in your actual codebase and, for anything that
escapes, writes a mechanically verified regression test.

## How it works

1. **Preflight.** Confirms you're in a git repo, `mole.json` parses, and
   (unless `--demo`) the agent CLI is on `PATH`.
2. **Baseline.** Runs your test command in a throwaway worktree at `HEAD`.
   It must be green — mole refuses to score a suite that's already red.
3. **Target selection.** Without `--file`, ranks candidate files by
   `churn × size` over the last 90 days and skips files hit in recent runs,
   so repeated runs rotate across the codebase.
4. **Ask the agent for bugs.** The model returns a JSON array of
   `{id, line, category, description, search, replace}`. mole parses this
   defensively — prose wrapping, markdown fences, and nested response
   fields are all expected, not exceptional.
5. **Test each mutant in isolation.** One `git worktree` per mutant, applied
   with an exact string replacement, tested with a timeout. A red result is
   rerun `confirmRuns` times before being credited as a genuine catch — if
   any rerun comes back green, it's recorded `flaky`, not `caught`.
6. **Score.** `escapeRate = escaped / (caught + escaped)`. Invalid, flaky,
   and inconclusive mutants are reported separately and excluded from the
   rate.

Full detail, including exactly how the flaky-confirmation logic works and
why `--write-tests` verifies its own output before writing anything, is in
[`docs/how-it-works.md`](docs/how-it-works.md).

## Configuration

`mole init` writes this file. Edit it directly:

```json
{
  "testCommand": "npm test",
  "testTimeoutSec": 300,
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "**/node_modules/**"],
  "mutantsPerRun": 10,
  "confirmRuns": 2,
  "agent": { "command": "claude", "args": ["-p", "--output-format", "json"], "responseField": "result" }
}
```

- `testCommand` — run in a worktree for every baseline and mutant check.
- `testTimeoutSec` — per-run timeout; a hang counts as `inconclusive`.
- `include` / `exclude` — glob patterns (`*`, `**`, `?`) selecting candidate
  target files.
- `mutantsPerRun` — bugs requested per `mole run`. Bounded by how long your
  suite takes: each mutant costs at least one full run.
- `confirmRuns` — reruns performed on a red result before it counts as
  caught, to rule out flakiness inflating the score.
- `agent` — the CLI mole shells out to. It must accept a prompt on stdin and
  print JSON on stdout. `command` and `args` are passed to `child_process`
  directly; `responseField` is the (dotted-path) field in that JSON holding
  the model's actual text response — mole then looks for a JSON array or
  object inside that text. To use a different agent CLI, point `command` at
  it and set `responseField` to wherever it puts its response text.

## Works with loop-rat

mole fits as a nightly loop at `.claude/loops/mole/` in
[loop-rat](https://github.com/mrbuzzoni/loop-rat): schedule `mole run
--write-tests` against your default branch and let it accumulate verified
regression tests over time instead of running once. loop-rat's `verify`
semantics are inverted for this loop — a red suite (a caught bug) is the
good outcome, and a stubbornly green one is what should page you. mole does
not depend on loop-rat in any way; it's a standalone CLI, and the loop is
just cron plus a prompt.

## Limitations

- **Equivalent mutants aren't bugs.** A mutant that changes nothing
  observable will always "escape" and tells you nothing about your tests.
  mole can't fully filter these out — see
  [`docs/writing-good-mutants.md`](docs/writing-good-mutants.md) for how to
  tune the prompt against them.
- **Slow suites bound the mutant count.** Each mutant costs one full test
  run, plus up to `confirmRuns` more if it's caught. A ten-minute suite
  makes a ten-mutant batch a multi-hour job.
- **Flaky suites degrade the signal.** Confirmation reruns catch flakiness
  on the specific path a mutant exercises, not flakiness in general. A
  suite that's unreliable across the board will still produce a noisy
  score.
- **Model quality determines mutant quality.** mole's report is only as
  good as the bugs the agent proposes. A weak model produces obvious or
  degenerate mutants; the escape rate will look better than it should.
- **Cost scales with suite runtime.** Every mutant is a full test run in a
  cloned worktree. Budget for `mutantsPerRun × (1 + confirmRuns)` runs per
  invocation, worst case.

## Development

```
npm install
npm run build
node --test dist/tests/*.test.js
```

or, everything at once:

```
bash tests/smoke.sh
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for project layout and what a good
PR looks like.

## License

MIT — see [`LICENSE`](LICENSE).
