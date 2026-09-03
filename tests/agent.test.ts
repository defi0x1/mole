import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, extractResponseText } from "../src/agent.js";

test("extractJson parses a plain JSON array", () => {
  const result = extractJson('[{"id":"m1"}]');
  assert.deepEqual(result, [{ id: "m1" }]);
});

test("extractJson unwraps a fenced code block", () => {
  const text = 'Sure, here are the mutants:\n```json\n[{"id":"m1"}]\n```\nLet me know if you want more.';
  assert.deepEqual(extractJson(text), [{ id: "m1" }]);
});

test("extractJson finds a bracketed object in surrounding prose", () => {
  const text = 'Here you go: {"id":"m1","line":4} -- hope that helps!';
  assert.deepEqual(extractJson(text), { id: "m1", line: 4 });
});

test("extractJson returns undefined for unparseable text", () => {
  assert.equal(extractJson("no json here at all"), undefined);
});

test("extractResponseText pulls a string field from the envelope", () => {
  const stdout = JSON.stringify({ result: '[{"id":"m1"}]', other: "ignored" });
  assert.equal(extractResponseText(stdout, "result"), '[{"id":"m1"}]');
});

test("extractResponseText follows a dotted field path", () => {
  const stdout = JSON.stringify({ message: { content: "payload" } });
  assert.equal(extractResponseText(stdout, "message.content"), "payload");
});

test("extractResponseText falls back to raw stdout when it is not JSON", () => {
  assert.equal(extractResponseText("just plain text", "result"), "just plain text");
});

test("extractResponseText stringifies a non-string field", () => {
  const stdout = JSON.stringify({ result: [1, 2, 3] });
  assert.equal(extractResponseText(stdout, "result"), "[1,2,3]");
});
