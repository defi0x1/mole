import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, ConfigError, DEFAULT_CONFIG, detectTestCommand } from "../src/config.js";

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
