import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Config } from "../src/config.js";
import { evaluateMutant, runBaseline, runPipeline, type AgentSource } from "../src/pipeline.js";
import type { MutantSpec } from "../src/mutate.js";

async function runGit(cwd: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} failed`))));
  });
}

/** Builds a tiny real git repo with a passing test suite, for end-to-end checks. */
async function makeFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mole-pipeline-test-"));
  await mkdir(path.join(dir, "src"));
  await mkdir(path.join(dir, "test"));
  await writeFile(
    path.join(dir, "src", "math.js"),
    "export function add(a, b) {\n  return a + b;\n}\n",
    "utf8"
  );
  await writeFile(
    path.join(dir, "test", "math.test.js"),
    "import { test } from 'node:test';\n" +
      "import assert from 'node:assert/strict';\n" +
      "import { add } from '../src/math.js';\n" +
      "test('adds two numbers', () => { assert.equal(add(2, 3), 5); });\n",
    "utf8"
  );
  await writeFile(dir + "/package.json", JSON.stringify({ name: "fixture", type: "module" }), "utf8");
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "add", "-A"]);
  await runGit(dir, ["-c", "user.email=t@t.com", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  return dir;
}

const baseConfig: Config = {
  testCommand: "node --test",
  testTimeoutSec: 30,
  include: ["src/**/*.js"],
  exclude: ["**/*.test.js"],
  mutantsPerRun: 3,
  confirmRuns: 1,
  agent: { command: "true", args: [], responseField: "result" },
};

test("runBaseline reports green for a passing suite", async () => {
  const dir = await makeFixtureRepo();
  try {
    const result = await runBaseline(dir, baseConfig);
    assert.equal(result.green, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluateMutant marks a non-matching search as invalid and leaves the repo untouched", async () => {
  const dir = await makeFixtureRepo();
  try {
    const mutant: MutantSpec = {
      id: "m1",
      line: 2,
      category: "operator",
      description: "does not exist in the file",
      search: "return a * b;",
      replace: "return a / b;",
    };
    const result = await evaluateMutant({ cwd: dir, config: baseConfig, file: "src/math.js", mutant });
    assert.equal(result.status, "invalid");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluateMutant marks a mutant the test suite catches as caught", async () => {
  const dir = await makeFixtureRepo();
  try {
    const mutant: MutantSpec = {
      id: "m2",
      line: 2,
      category: "operator",
      description: "flips addition to subtraction",
      search: "return a + b;",
      replace: "return a - b;",
    };
    const result = await evaluateMutant({ cwd: dir, config: baseConfig, file: "src/math.js", mutant });
    assert.equal(result.status, "caught");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("evaluateMutant marks a mutant the test suite misses as escaped", async () => {
  const dir = await makeFixtureRepo();
  try {
    const mutant: MutantSpec = {
      id: "m3",
      line: 1,
      category: "cosmetic",
      description: "renames the function body's parameter — behavior is unaffected",
      search: "export function add(a, b) {\n  return a + b;\n}",
      replace: "export function add(a, b) {\n  const sum = a + b;\n  return sum;\n}",
    };
    const result = await evaluateMutant({ cwd: dir, config: baseConfig, file: "src/math.js", mutant });
    assert.equal(result.status, "escaped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runPipeline scores a batch of mutants and records history", async () => {
  const dir = await makeFixtureRepo();
  try {
    const mutants: MutantSpec[] = [
      {
        id: "caught-one",
        line: 2,
        category: "operator",
        description: "flips addition to subtraction",
        search: "return a + b;",
        replace: "return a - b;",
      },
      {
        id: "escaped-one",
        line: 1,
        category: "cosmetic",
        description: "adds an unused local — behavior is unaffected",
        search: "export function add(a, b) {\n  return a + b;\n}",
        replace: "export function add(a, b) {\n  const unused = 0;\n  return a + b;\n}",
      },
      {
        id: "invalid-one",
        line: 1,
        category: "operator",
        description: "search text that is not present in the file",
        search: "this text does not appear anywhere",
        replace: "neither does this",
      },
    ];
    const agentSource: AgentSource = {
      proposeMutants: async () => mutants,
      proposeTest: async () => {
        throw new Error("not used in this test");
      },
    };

    const summary = await runPipeline({
      cwd: dir,
      config: baseConfig,
      file: "src/math.js",
      writeTests: false,
      agentSource,
    });

    assert.equal(summary.planted, 3);
    assert.equal(summary.caught, 1);
    assert.equal(summary.escaped, 1);
    assert.equal(summary.invalid, 1);
    assert.equal(summary.escapeRate, 0.5);

    const historyRaw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(dir, ".mole", "history.jsonl"), "utf8")
    );
    const lines = historyRaw.trim().split("\n");
    assert.equal(lines.length, 1);
    const recorded = JSON.parse(lines[0]);
    assert.equal(recorded.file, "src/math.js");
    assert.equal(recorded.escaped, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
