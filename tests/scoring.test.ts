import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreResults } from "../src/pipeline.js";
import type { MutantResult, MutantSpec } from "../src/mutate.js";

function result(status: MutantResult["status"]): MutantResult {
  const spec: MutantSpec = { id: "m", line: 1, category: "c", description: "d", search: "a", replace: "b" };
  return { spec, file: "f.ts", status };
}

test("scoreResults computes escape rate from caught+escaped only", () => {
  const results = [result("caught"), result("caught"), result("escaped")];
  const score = scoreResults(results);
  assert.equal(score.caught, 2);
  assert.equal(score.escaped, 1);
  assert.equal(score.escapeRate, 1 / 3);
});

test("scoreResults excludes invalid, flaky, and inconclusive from the denominator", () => {
  const results = [
    result("caught"),
    result("escaped"),
    result("invalid"),
    result("invalid"),
    result("flaky"),
    result("inconclusive"),
  ];
  const score = scoreResults(results);
  assert.equal(score.invalid, 2);
  assert.equal(score.flaky, 1);
  assert.equal(score.inconclusive, 1);
  assert.equal(score.escapeRate, 0.5); // 1 escaped / (1 caught + 1 escaped)
});

test("scoreResults returns a null escape rate when nothing was scoreable", () => {
  const results = [result("invalid"), result("flaky"), result("inconclusive")];
  const score = scoreResults(results);
  assert.equal(score.escapeRate, null);
});

test("scoreResults on an all-caught run reports a zero escape rate", () => {
  const results = [result("caught"), result("caught")];
  const score = scoreResults(results);
  assert.equal(score.escapeRate, 0);
});
