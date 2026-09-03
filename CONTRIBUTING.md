# Contributing

## Build and test

```
npm install
npm run build
node --test dist/tests/*.test.js
```

Or run everything CI runs, in one shot:

```
bash tests/smoke.sh
```

`npm link` after building if you want a `mole` binary on your PATH while you
work.

## Project layout

- `src/` — implementation. One module per concern: `config.ts`, `git.ts`
  (worktree handling), `agent.ts` (CLI adapter), `mutate.ts`, `runner.ts`
  (test execution), `pipeline.ts` (orchestration), `report.ts`, `history.ts`,
  `cli.ts`.
- `tests/` — unit tests plus a couple of integration tests that build real
  git worktrees and run a real test suite in them. `smoke.sh` is the CI
  entry point.
- `fixtures/demo/` — the project `mole run --demo` operates on. If you
  change it, make sure the canned `mutants.json` still has a realistic mix
  of caught, escaped, and invalid mutants, and that `tests.json` still
  contains regression tests that verifiably fail against their mutant and
  pass against clean HEAD.

## Ground rules

- Zero runtime dependencies. `typescript` and `@types/node` are the only
  devDependencies this project accepts. If you think you need a third, open
  an issue first and make the case.
- `search`/`replace` mutation application must stay exact-string matching,
  not diffs — that's a deliberate choice, not a shortcut (see
  `docs/how-it-works.md`).
- Never touch the user's working tree when applying a mutant. Everything
  destructive happens in a `git worktree`, cleaned up in a `finally`.
- Any change to the confirm/flaky logic or to scoring needs a test in
  `tests/mutate.test.ts` or `tests/scoring.test.ts` — this is the part of
  the tool that has to be trustworthy above all else.

## What a good PR looks like

- One concern per PR. A bug fix, a new flag, a doc fix — not all three.
- Tests for behavior changes. `node --test` against compiled output, real
  assertions.
- A description that says what changed and why, not just what.
- If you touched the CLI surface or `mole.json` shape, update the README
  and `docs/` in the same PR.
