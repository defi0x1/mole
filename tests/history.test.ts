import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendHistory,
  readHistory,
  recentlyTargetedFiles,
  lastEntryForFile,
  sparkline,
  type HistoryEntry,
} from "../src/history.js";

function entry(file: string, escapeRate: number | null, timestamp = "2026-01-01T00:00:00.000Z"): HistoryEntry {
  return { timestamp, file, planted: 10, caught: 7, escaped: 3, invalid: 0, flaky: 0, inconclusive: 0, escapeRate };
}

test("readHistory returns an empty array when no history file exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mole-history-test-"));
  try {
    assert.deepEqual(await readHistory(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendHistory then readHistory round-trips entries in order", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mole-history-test-"));
  try {
    await appendHistory(dir, entry("a.ts", 0.3));
    await appendHistory(dir, entry("b.ts", 0.1));
    const history = await readHistory(dir);
    assert.equal(history.length, 2);
    assert.equal(history[0].file, "a.ts");
    assert.equal(history[1].file, "b.ts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recentlyTargetedFiles returns the files from the last N runs", () => {
  const history = [entry("a.ts", 0.1), entry("b.ts", 0.2), entry("c.ts", 0.3)];
  const recent = recentlyTargetedFiles(history, 2);
  assert.equal(recent.has("a.ts"), false);
  assert.equal(recent.has("b.ts"), true);
  assert.equal(recent.has("c.ts"), true);
});

test("lastEntryForFile finds the most recent entry for a given file", () => {
  const history = [
    entry("a.ts", 0.5, "2026-01-01T00:00:00.000Z"),
    entry("b.ts", 0.2, "2026-01-02T00:00:00.000Z"),
    entry("a.ts", 0.1, "2026-01-03T00:00:00.000Z"),
  ];
  const last = lastEntryForFile(history, "a.ts");
  assert.equal(last?.timestamp, "2026-01-03T00:00:00.000Z");
});

test("lastEntryForFile returns undefined when the file has no history", () => {
  assert.equal(lastEntryForFile([entry("a.ts", 0.1)], "z.ts"), undefined);
});

test("sparkline maps rates to a monotonic range of block characters", () => {
  const spark = sparkline([0, 0.5, 1]);
  assert.equal(spark.length, 3);
  assert.equal(spark[0], "▁");
  assert.equal(spark[2], "█");
});

test("sparkline renders a space for null (missing) entries", () => {
  const spark = sparkline([0, null, 1]);
  assert.equal(spark[1], " ");
});

test("sparkline returns an empty string when there is no data", () => {
  assert.equal(sparkline([null, null]), "");
});
