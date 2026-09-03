import { readFile } from "node:fs/promises";
import path from "node:path";

export interface AgentConfig {
  command: string;
  args: string[];
  responseField: string;
}

export interface Config {
  testCommand: string;
  testTimeoutSec: number;
  include: string[];
  exclude: string[];
  mutantsPerRun: number;
  confirmRuns: number;
  agent: AgentConfig;
}

export const DEFAULT_CONFIG: Config = {
  testCommand: "npm test",
  testTimeoutSec: 300,
  include: ["src/**/*.ts"],
  exclude: ["**/*.test.ts", "**/node_modules/**"],
  mutantsPerRun: 10,
  confirmRuns: 2,
  agent: {
    command: "claude",
    args: ["-p", "--output-format", "json"],
    responseField: "result",
  },
};

export class ConfigError extends Error {}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Parses and validates mole.json contents. Unknown/missing fields fall back
 * to defaults; fields present with the wrong type raise a ConfigError so
 * mistakes are caught at load time rather than silently ignored.
 */
export function parseConfig(raw: string): Config {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`mole.json is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError("mole.json must contain a JSON object");
  }

  const obj = data as Record<string, unknown>;
  const config: Config = {
    testCommand: DEFAULT_CONFIG.testCommand,
    testTimeoutSec: DEFAULT_CONFIG.testTimeoutSec,
    include: [...DEFAULT_CONFIG.include],
    exclude: [...DEFAULT_CONFIG.exclude],
    mutantsPerRun: DEFAULT_CONFIG.mutantsPerRun,
    confirmRuns: DEFAULT_CONFIG.confirmRuns,
    agent: { ...DEFAULT_CONFIG.agent },
  };

  if ("testCommand" in obj) {
    if (typeof obj.testCommand !== "string" || obj.testCommand.trim() === "") {
      throw new ConfigError("testCommand must be a non-empty string");
    }
    config.testCommand = obj.testCommand;
  }

  if ("testTimeoutSec" in obj) {
    if (typeof obj.testTimeoutSec !== "number" || !Number.isFinite(obj.testTimeoutSec) || obj.testTimeoutSec <= 0) {
      throw new ConfigError("testTimeoutSec must be a positive number");
    }
    config.testTimeoutSec = obj.testTimeoutSec;
  }

  if ("include" in obj) {
    if (!isStringArray(obj.include) || obj.include.length === 0) {
      throw new ConfigError("include must be a non-empty array of glob strings");
    }
    config.include = obj.include;
  }

  if ("exclude" in obj) {
    if (!isStringArray(obj.exclude)) {
      throw new ConfigError("exclude must be an array of glob strings");
    }
    config.exclude = obj.exclude;
  }

  if ("mutantsPerRun" in obj) {
    if (typeof obj.mutantsPerRun !== "number" || !Number.isInteger(obj.mutantsPerRun) || obj.mutantsPerRun <= 0) {
      throw new ConfigError("mutantsPerRun must be a positive integer");
    }
    config.mutantsPerRun = obj.mutantsPerRun;
  }

  if ("confirmRuns" in obj) {
    if (typeof obj.confirmRuns !== "number" || !Number.isInteger(obj.confirmRuns) || obj.confirmRuns < 0) {
      throw new ConfigError("confirmRuns must be a non-negative integer");
    }
    config.confirmRuns = obj.confirmRuns;
  }

  if ("agent" in obj) {
    if (typeof obj.agent !== "object" || obj.agent === null || Array.isArray(obj.agent)) {
      throw new ConfigError("agent must be an object with command, args, responseField");
    }
    const agent = obj.agent as Record<string, unknown>;
    const merged: AgentConfig = { ...DEFAULT_CONFIG.agent };
    if ("command" in agent) {
      if (typeof agent.command !== "string" || agent.command.trim() === "") {
        throw new ConfigError("agent.command must be a non-empty string");
      }
      merged.command = agent.command;
    }
    if ("args" in agent) {
      if (!isStringArray(agent.args)) {
        throw new ConfigError("agent.args must be an array of strings");
      }
      merged.args = agent.args;
    }
    if ("responseField" in agent) {
      if (typeof agent.responseField !== "string" || agent.responseField.trim() === "") {
        throw new ConfigError("agent.responseField must be a non-empty string");
      }
      merged.responseField = agent.responseField;
    }
    config.agent = merged;
  }

  return config;
}

export async function loadConfig(cwd: string, file = "mole.json"): Promise<Config> {
  const configPath = path.join(cwd, file);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new ConfigError(
      `no mole.json found in ${cwd}. Run "mole init" first.`
    );
  }
  return parseConfig(raw);
}

export function configPath(cwd: string, file = "mole.json"): string {
  return path.join(cwd, file);
}

const SOURCE_EXTS = [
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rs", "go", "rb", "java", "php", "cs", "kt", "swift",
];
const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|target|vendor|coverage|\.git)(\/|$)/;
const TEST_PATH = /(^|\/)(__tests__|tests?)(\/)|\.(test|spec)\.|_test\./;

/**
 * Picks include/exclude globs from the files a project actually has.
 *
 * The default is TypeScript under src/, which is wrong for most repos. Guessing
 * from real paths means `mole run` works after `mole init` instead of failing
 * with "no files match include/exclude patterns".
 */
export function detectSourceGlobs(
  files: string[]
): { include: string[]; exclude: string[] } | undefined {
  const sources = files.filter((f) => {
    if (IGNORED_DIRS.test(f)) return false;
    if (TEST_PATH.test(f)) return false;
    const ext = f.split(".").pop();
    return ext !== undefined && SOURCE_EXTS.includes(ext);
  });
  if (sources.length === 0) return undefined;

  const tally = (xs: string[]): string => {
    const counts = new Map<string, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    // sort by count, then alphabetically, so the result is deterministic
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  };

  const ext = tally(sources.map((f) => f.split(".").pop() as string));
  const ofExt = sources.filter((f) => f.endsWith("." + ext));
  const root = tally(ofExt.map((f) => (f.includes("/") ? f.split("/")[0] : ".")));

  const include = [root === "." ? `**/*.${ext}` : `${root}/**/*.${ext}`];
  const exclude = [
    `**/*.test.${ext}`,
    `**/*.spec.${ext}`,
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
  ];
  return { include, exclude };
}

/** Reads the "test" script from a package.json object, if present. */
export function detectTestCommand(pkg: unknown): string | undefined {
  if (typeof pkg !== "object" || pkg === null) return undefined;
  const scripts = (pkg as Record<string, unknown>).scripts;
  if (typeof scripts !== "object" || scripts === null) return undefined;
  const test = (scripts as Record<string, unknown>).test;
  return typeof test === "string" && test.trim() !== "" ? test : undefined;
}
