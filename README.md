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

## Requirements

- **Node 20 or newer** and **git** -- mole runs each bug in a git worktree, so
  the project you point it at has to be a git repository.
- **A test suite that currently passes.** This is the measuring instrument. If
  your tests are red, mole refuses to start, because you cannot score a suite
  that is already failing.
- **A coding-agent CLI on your PATH** for real runs. The default is `claude`;
  any CLI that takes a prompt on stdin and returns JSON works, and it is
  configurable. Not needed for `mole run --demo`, which is fully offline.

## Install

### The fast way: have your agent do it

Paste this into Claude Code, Cursor, or whatever agent you use, from inside the
project you want to test:

```
Set up mole in this repository and run it for me.

mole plants realistic bugs in a file, runs my test suite against each one, and
reports which bugs my tests failed to catch.
Repo: https://github.com/defi0x1/mole

Please do this in order:

1. Check I have Node 20+, git, and a test command that works. If anything is
   missing, tell me instead of guessing or installing things silently.

2. Clone mole somewhere outside this project (for example ~/.local/share/mole),
   then run: npm install && npm run build && npm link
   If npm link fails with a permissions error, skip it and use the absolute
   path to <clone>/bin/mole.js everywhere below instead.

3. Run `mole run --demo` first. It is offline and needs no API key. Do not
   continue until it prints an ESCAPE REPORT -- that proves the install works.

4. Come back to my repo and run `mole init`, then open the generated mole.json
   and correct it for this project specifically:
   - testCommand: the command that actually runs my tests
   - include: my real source directory, not the default guess
   - exclude: test files, fixtures, node_modules, build output
   - if my test suite takes longer than about 30 seconds, set mutantsPerRun to 5

5. Run my test suite and confirm it is green. mole needs a passing baseline and
   will refuse to run otherwise. If it is red, stop and tell me what is failing.

6. Pick the single most important file in this repo -- whatever handles money,
   auth, permissions, or core business logic -- and run:
   mole run --file <that file>

7. Explain the escape report to me in plain language: what each escaped bug
   means, whether it is a genuine gap in my tests or a mutant that does not
   matter, and which one you would fix first.

Do not run `mole run --write-tests` until I have seen the report and said yes.
```

### The manual way

```
git clone https://github.com/defi0x1/mole.git
cd mole
npm install
npm run build
npm link
```

`npm link` puts a `mole` binary on your PATH pointing at this checkout. If it
fails on permissions, skip it -- `node /path/to/mole/bin/mole.js` works exactly
the same everywhere `mole` appears below.

## Quickstart

Three steps, in this order.

**1. Prove it works, offline.**

```
mole run --demo
```

Runs the entire real pipeline -- worktrees, test runs, confirmation reruns,
scoring -- against a bundled fixture project, substituting canned bugs for the
model call. No API key, no network, nothing from your project. You should see an
ESCAPE REPORT.

**2. Point it at your project.**

```
cd /path/to/your/project
mole init
```

Detects your test command and writes `mole.json`. Open it and check
`testCommand`, `include`, and `exclude` are right for your layout -- the
detection is a guess, not an oracle.

**3. Attack your most important file.**

```
mole run --file src/billing/pricing.ts
```

Start with one file that matters rather than the whole repo. Every mutant costs
a full test run, so a 30-second suite and 10 mutants is five minutes.

When you trust the report, let it close the gaps:

```
mole run --file src/billing/pricing.ts --write-tests
```

Each generated test is verified to fail with the bug present and pass without it
before it is written to disk. Tests that fail that check are discarded.

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

## Running it on a schedule

mole is built to run unattended. Targets rotate automatically -- it reads
`.mole/history.jsonl` and skips files hit recently -- so a nightly run walks
the codebase instead of re-testing one file forever. `--json` emits the
machine-readable report, and the escape rate is tracked across runs, so the
number trends as you close gaps.

Note that the exit-code contract is inverted from an ordinary test step: a
red suite under a mutant is the good outcome. Check the report, not the
process exit code, if you wire this into automation.

## Troubleshooting

**"baseline suite is not green"** -- mole ran your `testCommand` at HEAD and it
failed. Fix the suite first. Scoring a red suite is meaningless.

**Every mutant escaped (100%)** -- usually one of three things: `testCommand` is
wrong and no tests actually ran; `include` points at files your tests never
exercise; or your tests genuinely assert nothing. Check the first two before
believing the third.

**Everything came back `invalid`** -- the model's search strings did not match
the file. This happens with very large files or a weak model. Try a smaller
target file.

**`npm link` fails with EACCES** -- skip it and call
`node /path/to/mole/bin/mole.js` directly. mole does not need to be on your PATH.

**It is too slow** -- lower `mutantsPerRun`, always pass `--file`, and target
files whose tests run quickly. Total time is roughly `mutantsPerRun x suite
duration`.

**An escaped bug looks harmless** -- some mutants are equivalent, meaning the
change has no observable effect. Those are not test gaps, and judging them is
your job, not the tool's.

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

## Also being built

Sibling tools on the same shape: a deterministic oracle does the scoring, and a
model is only ever allowed to write the prose. Not public yet.

- **burrow** -- gives any command a disposable git worktree, hard limits, and a receipt
- **drift-graph** -- snapshots your import graph and shows which architectural boundaries got crossed
- **hindsight** -- replays an EVM wallet's trades against what would have happened if it had done nothing

## License

MIT — see [`LICENSE`](LICENSE).
