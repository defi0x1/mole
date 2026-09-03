import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMutants, decideMutantStatus } from "../src/mutate.js";

test("parseMutants accepts a well-formed array", () => {
  const raw = [
    { id: "m1", line: 4, category: "operator", description: "flips +", search: "a + b", replace: "a - b" },
  ];
  const mutants = parseMutants(raw);
  assert.equal(mutants.length, 1);
  assert.equal(mutants[0].id, "m1");
  assert.equal(mutants[0].search, "a + b");
});

test("parseMutants accepts a {mutants: [...]} wrapper", () => {
  const raw = { mutants: [{ search: "x", replace: "y" }] };
  const mutants = parseMutants(raw);
  assert.equal(mutants.length, 1);
});

test("parseMutants drops entries missing search or replace", () => {
  const raw = [
    { search: "a", replace: "b" },
    { replace: "only replace" },
    { search: "only search" },
    { search: "", replace: "empty search" },
  ];
  assert.equal(parseMutants(raw).length, 1);
});

test("parseMutants drops no-op mutants where search equals replace", () => {
  const raw = [{ search: "same", replace: "same" }];
  assert.equal(parseMutants(raw).length, 0);
});

test("parseMutants fills in defaults for missing optional fields", () => {
  const raw = [{ search: "a", replace: "b" }];
  const [mutant] = parseMutants(raw);
  assert.equal(mutant.category, "unspecified");
  assert.equal(mutant.line, 0);
  assert.ok(mutant.id.length > 0);
});

test("parseMutants returns an empty array for garbage input", () => {
  assert.deepEqual(parseMutants("not an array"), []);
  assert.deepEqual(parseMutants(null), []);
  assert.deepEqual(parseMutants(42), []);
});

test("parseMutants assigns distinct auto-ids when id is missing", () => {
  const raw = [
    { search: "a", replace: "b" },
    { search: "c", replace: "d" },
  ];
  const mutants = parseMutants(raw);
  assert.notEqual(mutants[0].id, mutants[1].id);
});

// --- flaky-confirmation decision logic ---

const clean = { passed: true, timedOut: false, crashed: false };
const red = { passed: false, timedOut: false, crashed: false };
const timedOut = { passed: false, timedOut: true, crashed: false };
const crashed = { passed: false, timedOut: false, crashed: true };

test("decideMutantStatus: green suite means the bug escaped", () => {
  assert.equal(decideMutantStatus(clean, []), "escaped");
});

test("decideMutantStatus: red suite confirmed red every rerun is caught", () => {
  assert.equal(decideMutantStatus(red, [false, false]), "caught");
});

test("decideMutantStatus: red suite that goes green on any rerun is flaky, not caught", () => {
  assert.equal(decideMutantStatus(red, [false, true]), "flaky");
  assert.equal(decideMutantStatus(red, [true, false]), "flaky");
});

test("decideMutantStatus: a red suite with zero confirm runs is caught", () => {
  assert.equal(decideMutantStatus(red, []), "caught");
});

test("decideMutantStatus: timeout or crash on the first run is inconclusive regardless of confirms", () => {
  assert.equal(decideMutantStatus(timedOut, []), "inconclusive");
  assert.equal(decideMutantStatus(crashed, []), "inconclusive");
});
