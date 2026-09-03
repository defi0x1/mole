# How it works

`mole run` executes six phases. Each one can abort the run with a clear
reason; nothing downstream runs on top of a bad precondition.

## 1. Preflight

mole checks that it is inside a git repository, that `mole.json` parses, and
(unless `--demo`) that the configured agent CLI is on `PATH`. Any failure
stops the run before anything is executed.

## 2. Baseline

mole creates a throwaway `git worktree` at `HEAD` and runs `testCommand` in
it. The suite must be green. If it is red, mole aborts: a mutation score is
only meaningful relative to a suite that passes on unmutated code, and a run
against a broken baseline would misreport every mutant as "caught" by
accident.

## 3. Target selection

If `--file` is not given, mole ranks candidate files (matched by `include`,
filtered by `exclude`) by `churn × size`, where churn is the number of
commits touching the file in the last 90 days (`git log --since --name-only`)
and size is the file's byte size. This biases toward files that are both
substantial and actively changing — the parts of the codebase most likely to
have accumulated untested edge cases.

Files hit in the last five recorded runs (`.mole/history.jsonl`) are skipped
when possible, so repeated runs rotate across the codebase instead of
hammering the same file. If every candidate has been recently targeted, mole
falls back to the full ranked list rather than refusing to run.

## 4. Asking the agent for bugs

mole sends the target file's contents to the configured agent CLI with a
prompt asking for plausible bugs, not syntactic mutations. The response must
be a JSON array of:

```json
{
  "id": "string",
  "line": 42,
  "category": "string",
  "description": "string",
  "search": "exact source snippet",
  "replace": "buggy replacement"
}
```

mole parses this defensively: the model's own CLI wrapper may return JSON
with the payload nested under a field (`responseField` in `mole.json`), and
the payload itself may be wrapped in prose or a markdown code fence. mole
tries, in order: parsing the text directly, unwrapping a fenced code block,
and scanning for the first balanced `[...]` or `{...}` span. Entries missing
`search` or `replace`, or where `search === replace` (a no-op), are dropped
rather than failing the batch.

mole uses exact `search`/`replace` strings instead of unified diffs. Models
reliably produce malformed diffs — wrong line numbers, off-by-one context,
hunks that don't apply. An exact string that must appear precisely once in
the file is unambiguous to apply and unambiguous to reject.

## 5. Testing each mutant in isolation

For each mutant, mole creates a fresh, detached `git worktree`, applies the
`search`/`replace` pair to the copy of the file inside it, and runs
`testCommand` there with the configured timeout. The worktree is removed in
a `finally` block whether the run succeeds, times out, or throws. **The
user's actual working tree is never touched by mutation** — only files
inside `--write-tests` output are ever written outside a worktree, and only
after mechanical verification (see below).

- If `search` does not match the file contents exactly once, the mutant is
  marked `invalid` and skipped — no test run happens.
- If the suite fails (non-zero exit), the mutant is provisionally caught.
  mole reruns the suite in the same worktree `confirmRuns` times (default
  2). If **any** rerun comes back green, the failure was not reliably caused
  by the mutant — the suite is flaky on this code path, and the mutant is
  recorded as `flaky`, not `caught`. This matters because a flaky suite
  would otherwise inflate its own catch rate: a mutant that happens to
  collide with a pre-existing flaky test looks identical to a mutant that
  was genuinely caught, unless you check.
- If the suite passes, the mutant `escaped`.
- If the run times out or the test process crashes outright, the mutant is
  `inconclusive` — mole makes no claim either way.

## 6. Scoring

```
escapeRate = escaped / (caught + escaped)
```

`invalid`, `flaky`, and `inconclusive` mutants are excluded from both the
numerator and the denominator and reported as separate counts. An escape
rate is only comparable across runs if it means the same thing every time —
mixing in mutants that were never really tested would make the number noise.

## 7. `--write-tests`

For each escaped mutant, mole asks the agent for a test that would have
caught it, then verifies the claim mechanically before trusting it:

1. Apply the mutant in a worktree, add the proposed test, run the suite. The
   new test **must fail**.
2. Apply the proposed test to a second, clean worktree at `HEAD`. The new
   test **must pass**.

Only tests that satisfy both are written to the real working tree; the rest
are discarded silently. This verification step is the reason `--write-tests`
is trustworthy: an LLM asked to write a regression test can produce a test
that looks right but doesn't actually exercise the bug, or that fails for an
unrelated reason (a typo, a bad import). An unverified generated test is
worse than no test — it sits in the suite looking like coverage while
verifying nothing. mole never writes a test it hasn't independently proven
does what it claims.

## 8. Recording

One JSON line is appended to `.mole/history.jsonl` per run, and the report
is printed. `mole report` reads this file to show trend and a sparkline;
target selection reads it to rotate which files get hit.
