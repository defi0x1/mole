import { readFile, writeFile, mkdtemp, rm, cp, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  DEFAULT_CONFIG,
  loadConfig,
  detectTestCommand,
  detectSourceGlobs,
  configPath,
  type Config,
} from "./config.js";
import * as git from "./git.js";
import { isOnPath } from "./agent.js";
import { runTestCommand } from "./runner.js";
import { preflight, runBaseline, runPipeline, LiveAgentSource, CannedAgentSource, type RunSummary } from "./pipeline.js";
import { readHistory, lastEntryForFile } from "./history.js";
import { formatReport, formatJson, formatHistoryReport } from "./report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function err(msg: string): void {
  process.stderr.write(msg + "\n");
}

async function cmdInit(cwd: string): Promise<number> {
  const target = configPath(cwd);
  try {
    await access(target);
    err(`mole.json already exists at ${target}. Remove it first if you want to regenerate it.`);
    return 1;
  } catch {
    // does not exist, proceed
  }

  let testCommand = DEFAULT_CONFIG.testCommand;
  try {
    const pkgRaw = await readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    testCommand = detectTestCommand(pkg) ?? testCommand;
  } catch {
    // no package.json, or it doesn't parse — fall back to the default
  }

  let globs: { include: string[]; exclude: string[] } | undefined;
  try {
    globs = detectSourceGlobs(await git.listTrackedFiles(cwd));
  } catch {
    // not a git repo, or git unavailable — fall back to the defaults
  }

  const config: Config = {
    ...DEFAULT_CONFIG,
    testCommand,
    include: globs?.include ?? [...DEFAULT_CONFIG.include],
    exclude: globs?.exclude ?? [...DEFAULT_CONFIG.exclude],
  };
  await writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");
  log(`wrote ${target}`);
  log(`  testCommand: ${config.testCommand}`);
  log(`  include:     ${config.include.join(", ")}`);
  if (!globs) {
    log(`  (could not detect your source layout — check include/exclude before running)`);
  }
  log(`edit mole.json to adjust include/exclude globs and the agent CLI before running "mole run".`);
  return 0;
}

async function cmdDoctor(cwd: string): Promise<number> {
  log("mole doctor");
  let ok = true;

  const inRepo = await git.isGitRepo(cwd);
  log(`  [${inRepo ? "ok" : "FAIL"}] inside a git repository`);
  ok &&= inRepo;

  let config: Config | undefined;
  try {
    config = await loadConfig(cwd);
    log(`  [ok] mole.json parses`);
  } catch (e) {
    log(`  [FAIL] mole.json: ${(e as Error).message}`);
    ok = false;
  }

  if (config) {
    const onPath = await isOnPath(config.agent.command);
    log(`  [${onPath ? "ok" : "FAIL"}] agent CLI "${config.agent.command}" is on PATH`);
    ok &&= onPath;

    if (inRepo) {
      log(`  running baseline suite ("${config.testCommand}")...`);
      const result = await runTestCommand(cwd, config.testCommand, config.testTimeoutSec);
      log(`  [${result.passed ? "ok" : "FAIL"}] baseline suite is green`);
      ok &&= result.passed;
    }
  }

  log(ok ? "\nall checks passed." : "\nsome checks failed.");
  return ok ? 0 : 1;
}

async function cmdReport(cwd: string, flags: Flags): Promise<number> {
  const last = typeof flags.last === "string" ? parseInt(flags.last, 10) : 10;
  const history = await readHistory(cwd);
  log(formatHistoryReport(history, Number.isFinite(last) ? last : 10));
  return 0;
}

async function setupDemoRepo(): Promise<string> {
  const fixtureDir = path.join(PROJECT_ROOT, "fixtures", "demo");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mole-demo-"));
  await cp(fixtureDir, tmp, { recursive: true });

  const runGit = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn("git", args, { cwd: tmp });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} failed`))));
    });

  await runGit(["init", "-q"]);
  await runGit(["-c", "user.email=mole@example.com", "-c", "user.name=mole", "add", "-A"]);
  await runGit(["-c", "user.email=mole@example.com", "-c", "user.name=mole", "commit", "-q", "-m", "demo project"]);
  return tmp;
}

async function cmdRun(cwd: string, flags: Flags): Promise<number> {
  const demo = flags.demo === true;
  const writeTests = flags["write-tests"] === true;
  const asJson = flags.json === true;
  const explicitFile = typeof flags.file === "string" ? flags.file : undefined;
  const count = typeof flags.count === "string" ? parseInt(flags.count, 10) : undefined;

  let runCwd = cwd;
  let cleanupDir: string | undefined;

  try {
    let config: Config;
    if (demo) {
      runCwd = await setupDemoRepo();
      cleanupDir = runCwd;
      config = await loadConfig(runCwd);
    } else {
      try {
        config = await loadConfig(cwd);
      } catch (e) {
        err((e as Error).message);
        return 1;
      }
    }

    const pre = await preflight(runCwd, config, { requireAgent: !demo });
    for (const check of pre.checks) {
      if (!check.ok) {
        err(`preflight failed: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
      }
    }
    if (!pre.ok) return 1;

    log("running baseline suite...");
    const baseline = await runBaseline(runCwd, config);
    if (!baseline.green) {
      err("baseline suite is red at HEAD. mole cannot score mutants against a suite that is already failing.");
      err(baseline.detail.output.slice(-2000));
      return 1;
    }

    const agentSource = demo
      ? new CannedAgentSource(path.join(runCwd, "mutants.json"), path.join(runCwd, "tests.json"))
      : new LiveAgentSource(config, runCwd);

    const targetFile = demo ? "src/cart.js" : explicitFile;

    const history = await readHistory(runCwd);
    const summary: RunSummary = await runPipeline({
      cwd: runCwd,
      config,
      file: targetFile,
      count,
      writeTests,
      agentSource,
    });

    const previous = lastEntryForFile(history, summary.file);

    if (asJson) {
      log(formatJson(summary));
    } else {
      log("");
      log(formatReport(summary, previous));
      log("");
    }
    return 0;
  } finally {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();
  const { flags } = parseArgs(rest);

  switch (command) {
    case "init":
      return cmdInit(cwd);
    case "run":
      return cmdRun(cwd, flags);
    case "report":
      return cmdReport(cwd, flags);
    case "doctor":
      return cmdDoctor(cwd);
    case undefined:
    case "-h":
    case "--help":
    case "help":
      log("mole — an adversary for your test suite\n");
      log("usage:");
      log("  mole init                          detect test command, write mole.json");
      log("  mole run [--file f] [--count n]     plant bugs and score your test suite");
      log("           [--demo] [--write-tests] [--json]");
      log("  mole report [--last n]             history and escape-rate trend");
      log("  mole doctor                        verify mole is ready to run");
      return command === undefined ? 1 : 0;
    default:
      err(`unknown command: ${command}`);
      err(`run "mole --help" for usage.`);
      return 1;
  }
}
