import { readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface HistoryEntry {
  timestamp: string;
  file: string;
  planted: number;
  caught: number;
  escaped: number;
  invalid: number;
  flaky: number;
  inconclusive: number;
  escapeRate: number | null;
}

export function historyPath(cwd: string): string {
  return path.join(cwd, ".mole", "history.jsonl");
}

export async function readHistory(cwd: string): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(historyPath(cwd), "utf8");
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as HistoryEntry);
    } catch {
      // skip corrupt lines rather than fail the whole read
    }
  }
  return entries;
}

export async function appendHistory(cwd: string, entry: HistoryEntry): Promise<void> {
  const file = historyPath(cwd);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}

/** Files targeted in the last `lookback` runs, used to rotate mutation targets. */
export function recentlyTargetedFiles(history: HistoryEntry[], lookback: number): Set<string> {
  return new Set(history.slice(-lookback).map((e) => e.file));
}

/** Most recent prior entry for a given file, used for the report trend line. */
export function lastEntryForFile(history: HistoryEntry[], file: string): HistoryEntry | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].file === file) return history[i];
  }
  return undefined;
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/** Renders escape-rate history as a compact ASCII/block sparkline. */
export function sparkline(rates: (number | null)[]): string {
  const known = rates.filter((r): r is number => r !== null);
  if (known.length === 0) return "";
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  return rates
    .map((r) => {
      if (r === null) return " ";
      const idx = Math.round(((r - min) / span) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[idx];
    })
    .join("");
}
