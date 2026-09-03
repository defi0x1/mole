import path from "node:path";
import type { RunSummary } from "./pipeline.js";
import type { HistoryEntry } from "./history.js";
import { sparkline } from "./history.js";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pct(rate: number | null): string {
  return rate === null ? "n/a" : `${Math.round(rate * 100)}%`;
}

export function formatReport(summary: RunSummary, previous?: HistoryEntry): string {
  const lines: string[] = [];
  const base = path.basename(summary.file);

  lines.push(`ESCAPE REPORT · ${fmtDate(summary.timestamp)} · ${summary.file}`);
  lines.push("");

  let summaryLine = `  ${summary.planted} planted · ${summary.escaped} escaped · escape rate ${pct(summary.escapeRate)}`;
  if (previous && previous.escapeRate !== null && summary.escapeRate !== null) {
    const arrow = summary.escapeRate > previous.escapeRate ? "▲" : summary.escapeRate < previous.escapeRate ? "▼" : "=";
    summaryLine += `   ${arrow} from ${pct(previous.escapeRate)} (${shortDate(previous.timestamp)})`;
  }
  lines.push(summaryLine);
  lines.push("");

  const escaped = summary.results.filter((r) => r.status === "escaped");
  const caughtCount = summary.results.filter((r) => r.status === "caught").length;

  escaped.forEach((r, idx) => {
    lines.push(`  ✗ ESCAPED  ${base}:${r.spec.line}   ${r.spec.description}`);
    if (idx === 0) {
      lines.push(`             your suite was green with this in place`);
    }
    const written = summary.writtenTests.find((w) => w.mutantId === r.spec.id);
    if (written) {
      lines.push(`             suggested test → ${written.testFile}`);
    }
  });

  if (caughtCount > 0) {
    lines.push(`  ✓ caught   ×${caughtCount}`);
  }

  lines.push("");

  const footerParts: string[] = [];
  footerParts.push(`${summary.invalid} invalid (patch did not apply)`);
  footerParts.push(`${summary.flaky} flaky`);
  if (summary.inconclusive > 0) {
    footerParts.push(`${summary.inconclusive} inconclusive`);
  }
  lines.push(`  ${footerParts.join(" · ")}`);

  return lines.join("\n");
}

export function formatJson(summary: RunSummary): string {
  return JSON.stringify(summary, null, 2);
}

export function formatHistoryReport(history: HistoryEntry[], last: number): string {
  const slice = history.slice(-last);
  if (slice.length === 0) {
    return "no runs recorded yet. Run \"mole run\" first.";
  }
  const lines: string[] = [];
  lines.push(`MOLE HISTORY · last ${slice.length} run${slice.length === 1 ? "" : "s"}`);
  lines.push("");
  for (const entry of slice) {
    const rate = pct(entry.escapeRate);
    lines.push(
      `  ${fmtDate(entry.timestamp)}  ${entry.file.padEnd(40)} ${rate.padStart(5)}   ` +
        `(${entry.caught} caught, ${entry.escaped} escaped, ${entry.invalid} invalid, ${entry.flaky} flaky)`
    );
  }
  lines.push("");
  const rates = slice.map((e) => e.escapeRate);
  const spark = sparkline(rates);
  if (spark) {
    lines.push(`  escape rate trend  ${spark}`);
  }
  return lines.join("\n");
}
