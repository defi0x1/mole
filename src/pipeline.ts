import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { Config } from "./config.js";
import * as git from "./git.js";
import { matchesAny } from "./glob.js";
import { runTestCommand, type TestRunResult } from "./runner.js";
import { parseMutants, buildMutantPrompt, buildTestPrompt, decideMutantStatus, type MutantSpec, type MutantResult } from "./mutate.js";
import { invokeAgent, extractJson } from "./agent.js";
import { appendHistory, readHistory, recentlyTargetedFiles, type HistoryEntry } from "./history.js";

export interface AgentSource {
  proposeMutants(filePath: string, fileContents: string, count: number): Promise<unknown>;
  proposeTest(filePath: string, fileContents: string, mutant: MutantSpec): Promise<unknown>;
}

export class LiveAgentSource implements AgentSource {
  constructor(private config: Config, private cwd: string) {}

  proposeMutants(filePath: string, fileContents: string, count: number): Promise<unknown> {
    const prompt = buildMutantPrompt(fileContents, filePath, count);
    return invokeAgent(this.config.agent, prompt, this.cwd);
  }

  proposeTest(filePath: string, fileContents: string, mutant: MutantSpec): Promise<unknown> {
    const prompt = buildTestPrompt(fileContents, filePath, mutant);
    return invokeAgent(this.config.agent, prompt, this.cwd);
  }
}

/** Reads canned mutants/tests from fixtures/demo, used by `mole run --demo`. */
export class CannedAgentSource implements AgentSource {
  constructor(private mutantsFile: string, private testsFile: string) {}

  async proposeMutants(): Promise<unknown> {
    const raw = await readFile(this.mutantsFile, "utf8");
    return JSON.parse(raw);
  }

  async proposeTest(_filePath: string, _fileContents: string, mutant: MutantSpec): Promise<unknown> {
    const raw = await readFile(this.testsFile, "utf8");
    const all = JSON.parse(raw) as Record<string, unknown>;
    const entry = all[mutant.id];
    if (entry === undefined) {
      throw new Error(`no canned test for mutant ${mutant.id}`);
    }
    return entry;
  }
}

export interface PreflightResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

export async function preflight(cwd: string, config: Config, opts: { requireAgent: boolean }): Promise<PreflightResult> {
  const checks: PreflightResult["checks"] = [];

  const inRepo = await git.isGitRepo(cwd);
  checks.push({ name: "inside a git repository", ok: inRepo });

  checks.push({ name: "mole.json parses", ok: true });

  if (opts.requireAgent) {
    const { isOnPath } = await import("./agent.js");
    const onPath = await isOnPath(config.agent.command);
    checks.push({
      name: `agent CLI "${config.agent.command}" is on PATH`,
      ok: onPath,
      detail: onPath ? undefined : `install/configure "${config.agent.command}" or set agent.command in mole.json`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

export interface BaselineResult {
  green: boolean;
  detail: TestRunResult;
}

/** Runs the test suite at HEAD in a throwaway worktree to confirm it is green. */
export async function runBaseline(cwd: string, config: Config): Promise<BaselineResult> {
  const wt = await git.addWorktree(cwd);
  try {
    const result = await runTestCommand(wt.path, config.testCommand, config.testTimeoutSec);
    return { green: result.passed, detail: result };
  } finally {
    await git.removeWorktree(cwd, wt);
  }
}

/** Ranks candidate files by churn x size, skipping files hit in recent runs. */
export async function selectTarget(cwd: string, config: Config): Promise<string> {
  const tracked = await git.listTrackedFiles(cwd);
  const candidates = tracked.filter(
    (f) => matchesAny(f, config.include) && !matchesAny(f, config.exclude)
  );
  if (candidates.length === 0) {
    throw new Error("no files match include/exclude patterns in mole.json");
  }

  const churn = await git.fileChurn(cwd, 90);
  const history = await readHistory(cwd);
  const recent = recentlyTargetedFiles(history, 5);

  const scored: { file: string; score: number }[] = [];
  for (const file of candidates) {
    let size = 0;
    try {
      const stat = await (await import("node:fs/promises")).stat(path.join(cwd, file));
      size = stat.size;
    } catch {
      continue;
    }
    const fileChurnCount = churn.get(file) ?? 0;
    scored.push({ file, score: (fileChurnCount + 1) * size });
  }

  const notRecent = scored.filter((s) => !recent.has(s.file));
  const pool = notRecent.length > 0 ? notRecent : scored;
  pool.sort((a, b) => b.score - a.score);
  if (pool.length === 0) {
    throw new Error("no eligible target files found");
  }
  return pool[0].file;
}

export interface EvaluateOptions {
  cwd: string;
  config: Config;
  file: string;
  mutant: MutantSpec;
}

/** Applies one mutant in an isolated worktree, runs the suite, and confirms red results. */
export async function evaluateMutant(opts: EvaluateOptions): Promise<MutantResult> {
  const { cwd, config, file, mutant } = opts;
  const wt = await git.addWorktree(cwd);
  try {
    const targetPath = path.join(wt.path, file);
    const applied = await git.applySearchReplace(targetPath, mutant.search, mutant.replace);
    if (!applied.ok) {
      return { spec: mutant, file, status: "invalid", detail: applied.reason };
    }

    const first = await runTestCommand(wt.path, config.testCommand, config.testTimeoutSec);

    // Suite went red on the first try. Confirm it isn't a flaky failure
    // before crediting the catch — see decideMutantStatus for the rule.
    const confirmPassed: boolean[] = [];
    if (!first.timedOut && !first.crashed && !first.passed) {
      for (let i = 0; i < config.confirmRuns; i++) {
        const confirm = await runTestCommand(wt.path, config.testCommand, config.testTimeoutSec);
        confirmPassed.push(confirm.passed);
      }
    }

    const status = decideMutantStatus(first, confirmPassed);
    const detail =
      status === "inconclusive"
        ? first.timedOut
          ? "test run timed out"
          : "test run crashed"
        : status === "flaky"
        ? "suite was green on a confirmation rerun"
        : undefined;
    return { spec: mutant, file, status, detail };
  } finally {
    await git.removeWorktree(cwd, wt);
  }
}

export interface WrittenTest {
  mutantId: string;
  testFile: string;
  line: number;
}

/**
 * For an escaped mutant, asks the agent for a regression test and mechanically
 * verifies it: the test must fail against the mutant and pass against clean
 * HEAD. Only verified tests are written to the real working tree.
 */
export async function proposeAndVerifyTest(
  cwd: string,
  config: Config,
  agentSource: AgentSource,
  file: string,
  mutant: MutantSpec
): Promise<WrittenTest | undefined> {
  const fileContents = await readFile(path.join(cwd, file), "utf8");
  let raw: unknown;
  try {
    raw = await agentSource.proposeTest(file, fileContents, mutant);
  } catch {
    return undefined;
  }

  const parsed = typeof raw === "string" ? extractJson(raw) : raw;
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { testFile, testCode } = parsed as Record<string, unknown>;
  if (typeof testFile !== "string" || typeof testCode !== "string" || testFile === "" || testCode === "") {
    return undefined;
  }

  // 1. Must fail against the mutant.
  const mutantWt = await git.addWorktree(cwd);
  try {
    const applied = await git.applySearchReplace(path.join(mutantWt.path, file), mutant.search, mutant.replace);
    if (!applied.ok) return undefined;
    const testPath = path.join(mutantWt.path, testFile);
    await mkdir(path.dirname(testPath), { recursive: true });
    await writeFile(testPath, testCode, "utf8");
    const againstMutant = await runTestCommand(mutantWt.path, config.testCommand, config.testTimeoutSec);
    if (againstMutant.passed) return undefined; // doesn't actually catch the bug
  } finally {
    await git.removeWorktree(cwd, mutantWt);
  }

  // 2. Must pass against clean HEAD.
  const cleanWt = await git.addWorktree(cwd);
  try {
    const testPath = path.join(cleanWt.path, testFile);
    await mkdir(path.dirname(testPath), { recursive: true });
    await writeFile(testPath, testCode, "utf8");
    const againstClean = await runTestCommand(cleanWt.path, config.testCommand, config.testTimeoutSec);
    if (!againstClean.passed) return undefined; // false positive, discard
  } finally {
    await git.removeWorktree(cwd, cleanWt);
  }

  // Verified on both counts: write it to the user's real working tree.
  const destPath = path.join(cwd, testFile);
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, testCode, "utf8");
  return { mutantId: mutant.id, testFile, line: mutant.line };
}

export interface RunOptions {
  cwd: string;
  config: Config;
  file?: string;
  count?: number;
  writeTests: boolean;
  agentSource: AgentSource;
}

export interface RunSummary {
  timestamp: string;
  file: string;
  planted: number;
  results: MutantResult[];
  caught: number;
  escaped: number;
  invalid: number;
  flaky: number;
  inconclusive: number;
  escapeRate: number | null;
  writtenTests: WrittenTest[];
}

export function scoreResults(results: MutantResult[]): Omit<RunSummary, "timestamp" | "file" | "planted" | "results" | "writtenTests"> {
  const caught = results.filter((r) => r.status === "caught").length;
  const escaped = results.filter((r) => r.status === "escaped").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const flaky = results.filter((r) => r.status === "flaky").length;
  const inconclusive = results.filter((r) => r.status === "inconclusive").length;
  const denom = caught + escaped;
  const escapeRate = denom > 0 ? escaped / denom : null;
  return { caught, escaped, invalid, flaky, inconclusive, escapeRate };
}

export async function runPipeline(opts: RunOptions): Promise<RunSummary> {
  const { cwd, config, agentSource } = opts;
  const file = opts.file ?? (await selectTarget(cwd, config));
  const count = opts.count ?? config.mutantsPerRun;

  const fileContents = await readFile(path.join(cwd, file), "utf8");
  const raw = await agentSource.proposeMutants(file, fileContents, count);
  const allMutants = parseMutants(raw).slice(0, count);

  const results: MutantResult[] = [];
  for (const mutant of allMutants) {
    const result = await evaluateMutant({ cwd, config, file, mutant });
    results.push(result);
  }

  const writtenTests: WrittenTest[] = [];
  if (opts.writeTests) {
    for (const result of results) {
      if (result.status !== "escaped") continue;
      const written = await proposeAndVerifyTest(cwd, config, agentSource, file, result.spec);
      if (written) writtenTests.push(written);
    }
  }

  const scored = scoreResults(results);
  const summary: RunSummary = {
    timestamp: new Date().toISOString(),
    file,
    planted: allMutants.length,
    results,
    writtenTests,
    ...scored,
  };

  const entry: HistoryEntry = {
    timestamp: summary.timestamp,
    file: summary.file,
    planted: summary.planted,
    caught: summary.caught,
    escaped: summary.escaped,
    invalid: summary.invalid,
    flaky: summary.flaky,
    inconclusive: summary.inconclusive,
    escapeRate: summary.escapeRate,
  };
  await appendHistory(cwd, entry);

  return summary;
}
