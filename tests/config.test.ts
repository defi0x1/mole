import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, ConfigError, DEFAULT_CONFIG, detectTestCommand, detectSourceGlobs } from "../src/config.js";

test("parseConfig returns defaults for an empty object", () => {
  const config = parseConfig("{}");
  assert.deepEqual(config, DEFAULT_CONFIG);
});

test("parseConfig merges provided fields over defaults", () => {
  const config = parseConfig(
    JSON.stringify({ testCommand: "yarn test", mutantsPerRun: 5 })
  );
  assert.equal(config.testCommand, "yarn test");
  assert.equal(config.mutantsPerRun, 5);
  assert.equal(config.confirmRuns, DEFAULT_CONFIG.confirmRuns);
});

test("parseConfig merges partial agent config over agent defaults", () => {
  const config = parseConfig(JSON.stringify({ agent: { command: "codex" } }));
  assert.equal(config.agent.command, "codex");
  assert.deepEqual(config.agent.args, DEFAULT_CONFIG.agent.args);
  assert.equal(config.agent.responseField, DEFAULT_CONFIG.agent.responseField);
});

test("parseConfig rejects invalid JSON", () => {
  assert.throws(() => parseConfig("{not json"), ConfigError);
});

test("parseConfig rejects a non-object top level", () => {
  assert.throws(() => parseConfig("[1,2,3]"), ConfigError);
  assert.throws(() => parseConfig('"hello"'), ConfigError);
});

test("parseConfig rejects wrong-typed fields", () => {
  assert.throws(() => parseConfig(JSON.stringify({ testCommand: 5 })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ mutantsPerRun: "ten" })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ mutantsPerRun: 0 })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ include: "src/**" })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ confirmRuns: -1 })), ConfigError);
  assert.throws(() => parseConfig(JSON.stringify({ agent: "claude" })), ConfigError);
});

test("parseConfig accepts confirmRuns of 0", () => {
  const config = parseConfig(JSON.stringify({ confirmRuns: 0 }));
  assert.equal(config.confirmRuns, 0);
});

test("detectTestCommand reads package.json scripts.test", () => {
  assert.equal(detectTestCommand({ scripts: { test: "vitest run" } }), "vitest run");
});

test("detectTestCommand returns undefined when absent or malformed", () => {
  assert.equal(detectTestCommand({}), undefined);
  assert.equal(detectTestCommand({ scripts: {} }), undefined);
  assert.equal(detectTestCommand({ scripts: { test: "" } }), undefined);
  assert.equal(detectTestCommand(null), undefined);
  assert.equal(detectTestCommand("not an object"), undefined);
});

test("detectSourceGlobs picks the dominant extension and root", () => {
  const globs = detectSourceGlobs([
    "src/order.js",
    "src/cart.js",
    "src/util.js",
    "test/order.test.js",
    "package.json",
    "README.md",
  ]);
  assert.deepEqual(globs?.include, ["src/**/*.js"]);
  assert.ok(globs?.exclude.includes("**/*.test.js"));
});

test("detectSourceGlobs prefers TypeScript when it dominates", () => {
  const globs = detectSourceGlobs(["src/a.ts", "src/b.ts", "src/c.ts", "scripts/x.js"]);
  assert.deepEqual(globs?.include, ["src/**/*.ts"]);
});

test("detectSourceGlobs ignores tests, node_modules and build output", () => {
  const globs = detectSourceGlobs([
    "node_modules/pkg/index.js",
    "dist/bundle.js",
    "__tests__/a.js",
    "lib/real.js",
  ]);
  assert.deepEqual(globs?.include, ["lib/**/*.js"]);
});

test("detectSourceGlobs handles sources at the repo root", () => {
  const globs = detectSourceGlobs(["main.go", "handler.go", "go.mod"]);
  assert.deepEqual(globs?.include, ["**/*.go"]);
});

test("detectSourceGlobs returns undefined when there is nothing to match", () => {
  assert.equal(detectSourceGlobs(["README.md", "LICENSE"]), undefined);
});
