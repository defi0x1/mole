import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesGlob, matchesAny } from "../src/glob.js";

test("matchesGlob supports ** across directories", () => {
  assert.equal(matchesGlob("src/billing/proration.ts", "src/**/*.ts"), true);
  assert.equal(matchesGlob("src/proration.ts", "src/**/*.ts"), true);
  assert.equal(matchesGlob("test/proration.ts", "src/**/*.ts"), false);
});

test("matchesGlob supports a single * within one path segment", () => {
  assert.equal(matchesGlob("src/foo.test.ts", "*.test.ts"), false);
  assert.equal(matchesGlob("foo.test.ts", "*.test.ts"), true);
});

test("matchesGlob treats node_modules exclusion correctly", () => {
  assert.equal(matchesGlob("packages/a/node_modules/x/index.js", "**/node_modules/**"), true);
  assert.equal(matchesGlob("src/index.js", "**/node_modules/**"), false);
});

test("matchesAny is true if any pattern matches", () => {
  assert.equal(matchesAny("src/a.test.ts", ["**/*.test.ts", "**/node_modules/**"]), true);
  assert.equal(matchesAny("src/a.ts", ["**/*.test.ts", "**/node_modules/**"]), false);
});
