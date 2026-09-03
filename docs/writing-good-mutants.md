# Writing good mutants

The default prompt (in `src/mutate.ts`, `buildMutantPrompt`) asks for
plausible bugs, not syntactic ones. The categories it names — forgotten
`await`, off-by-one, missing null check, flipped comparison, wrong default,
bad rounding, swapped arguments — are a starting point, not a limit. Tune it
for your codebase by editing that prompt directly, or by pointing
`agent.command` at a CLI with a system prompt already scoped to your domain.

## What makes a mutant worth planting

A good mutant is a bug a competent engineer on your team could plausibly
write and not notice in review. If you'd catch it reading the diff, it isn't
testing your test suite — it's testing your code review. Concretely:

- **Prefer bugs that live at boundaries.** Off-by-one, inclusive-vs-exclusive
  comparisons, empty-collection handling. These are the bugs unit tests
  written against the happy path miss.
- **Prefer bugs that are silent.** A mutant that throws immediately on any
  input is a bad mutant — it will always be caught, or always be invalid
  because nothing exercises that path. The valuable mutants change output
  without changing control flow.
- **Avoid bugs that are equivalent to the original.** Renaming a local
  variable, reordering independent statements, adding a redundant check —
  these change nothing observable and will always "escape" without telling
  you anything about your tests. mole can't fully prevent the model from
  proposing these; if you see the same category of no-op mutant repeatedly,
  tighten the prompt to exclude it explicitly.
- **Scope mutants to one file at a time.** mole sends one file's contents
  per request. If your bugs live at integration boundaries between files,
  point `--file` at the file that owns the contract (the caller, usually)
  rather than the leaf implementation.

## Tuning `mutantsPerRun` and `confirmRuns`

`mutantsPerRun` is bounded by your test suite's runtime: each mutant costs
one full suite run, plus up to `confirmRuns` extra runs if the suite goes
red. A 30-second suite makes 10 mutants a two-to-five-minute run. A
10-minute suite makes the same batch impractical for anything but a nightly
job — see `docs/how-it-works.md` and the README's Limitations section.

`confirmRuns` trades run time for confidence that a "caught" result is real
and not a coincidence with a pre-existing flaky test. If your suite is known
to be reliable, 1 is enough. If you've seen intermittent failures in CI
unrelated to code changes, raise it — a flaky suite that isn't confirmed
will report a catch rate that has nothing to do with your mutants.

## Iterating

Run `mole report` after a handful of runs. If the escape rate stays flat
across very different files, the prompt is probably producing a narrow band
of bug categories your suite either always or never catches. Broaden the
categories, or target files you suspect are under-tested with `--file`
directly instead of relying on churn-based selection.
