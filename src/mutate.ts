export interface MutantSpec {
  id: string;
  line: number;
  category: string;
  description: string;
  search: string;
  replace: string;
}

export type MutantStatus = "caught" | "escaped" | "flaky" | "invalid" | "inconclusive";

export interface MutantResult {
  spec: MutantSpec;
  file: string;
  status: MutantStatus;
  detail?: string;
}

export interface RunOutcome {
  passed: boolean;
  timedOut: boolean;
  crashed: boolean;
}

/**
 * Pure decision function for one mutant's fate, isolated so the
 * flaky-confirmation rule can be unit tested without spawning real
 * processes. `first` is the initial test run after the mutant is applied;
 * `confirmPassed` is one boolean per confirmation rerun (only meaningful
 * when `first` was red). Any green confirmation rerun means the suite is
 * flaky on this code path, not a genuine catch — a flaky suite must not be
 * able to inflate its own score.
 */
export function decideMutantStatus(first: RunOutcome, confirmPassed: boolean[]): MutantStatus {
  if (first.timedOut || first.crashed) return "inconclusive";
  if (first.passed) return "escaped";
  if (confirmPassed.some((passed) => passed)) return "flaky";
  return "caught";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates the agent's mutant list defensively. Individual malformed
 * entries are dropped rather than failing the whole batch — the model's
 * JSON is not trusted to be perfectly shaped.
 */
export function parseMutants(raw: unknown): MutantSpec[] {
  const candidates = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray((raw as any).mutants) ? (raw as any).mutants : undefined;

  if (!Array.isArray(candidates)) return [];

  const mutants: MutantSpec[] = [];
  let autoId = 0;
  for (const item of candidates) {
    if (!isRecord(item)) continue;
    const { id, line, category, description, search, replace } = item as Record<string, unknown>;
    if (typeof search !== "string" || search === "") continue;
    if (typeof replace !== "string") continue;
    if (search === replace) continue;
    mutants.push({
      id: typeof id === "string" && id !== "" ? id : `m${++autoId}`,
      line: typeof line === "number" && Number.isFinite(line) ? line : 0,
      category: typeof category === "string" && category !== "" ? category : "unspecified",
      description: typeof description === "string" && description !== "" ? description : "no description provided",
      search,
      replace,
    });
  }
  return mutants;
}

export function buildMutantPrompt(fileContents: string, filePath: string, count: number): string {
  return `You are helping test a test suite's ability to catch realistic bugs.

Given the source file below (${filePath}), propose ${count} small, plausible bugs a competent
engineer could actually introduce: a forgotten await, an off-by-one in a loop or slice, a
missing null/undefined check, a flipped comparison, a dropped edge case, a wrong default,
incorrect rounding, a swapped argument order. Do not propose absurd or syntactically obvious
changes. Each bug must be a real behavior change, not a no-op.

Respond with ONLY a JSON array, no prose, no markdown fences. Each element:
{
  "id": "short identifier",
  "line": <line number in the original file>,
  "category": "short category label",
  "description": "one sentence describing the bug from a reviewer's perspective",
  "search": "the exact original source snippet to replace (must appear exactly once in the file)",
  "replace": "the buggy replacement snippet"
}

FILE:
${fileContents}`;
}

export function buildTestPrompt(fileContents: string, filePath: string, mutant: MutantSpec): string {
  return `A mutation testing tool planted this bug in ${filePath} and the existing test suite did not
catch it:

Category: ${mutant.category}
Description: ${mutant.description}
Original code:
${mutant.search}

Buggy code:
${mutant.replace}

Write ONE new test case that fails when the buggy code is present and passes against the
original code. Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "testFile": "relative path to a test file to write or extend",
  "testCode": "the full contents to write, importing whatever is needed"
}

FULL SOURCE FILE FOR CONTEXT:
${fileContents}`;
}
