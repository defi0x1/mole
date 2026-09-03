import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export class GitError extends Error {}

function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run(cwd, args);
  if (result.code !== 0) {
    throw new GitError(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await run(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

export async function getHeadSha(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export interface Worktree {
  path: string;
}

/** Creates a detached worktree at HEAD (or the given ref) outside the repo tree. */
export async function addWorktree(cwd: string, ref = "HEAD"): Promise<Worktree> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "mole-wt-"));
  const wtPath = path.join(parent, "wt");
  await git(cwd, ["worktree", "add", "--detach", "--quiet", wtPath, ref]);
  return { path: wtPath };
}

export async function removeWorktree(cwd: string, wt: Worktree): Promise<void> {
  try {
    await git(cwd, ["worktree", "remove", "--force", wt.path]);
  } catch {
    // fall through to filesystem cleanup below
  }
  await rm(path.dirname(wt.path), { recursive: true, force: true }).catch(() => {});
  await run(cwd, ["worktree", "prune"]);
}

/** Counts commits touching each tracked file in the last `sinceDays` days. */
export async function fileChurn(cwd: string, sinceDays: number): Promise<Map<string, number>> {
  const out = await run(cwd, [
    "log",
    `--since=${sinceDays}.days`,
    "--name-only",
    "--pretty=format:",
  ]);
  const churn = new Map<string, number>();
  if (out.code !== 0) return churn;
  for (const line of out.stdout.split("\n")) {
    const file = line.trim();
    if (!file) continue;
    churn.set(file, (churn.get(file) ?? 0) + 1);
  }
  return churn;
}

export async function listTrackedFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ["ls-files"]);
  return out.split("\n").filter(Boolean);
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
}

/** Applies an exact search/replace to a file. Fails unless `search` matches exactly once. */
export async function applySearchReplace(
  filePath: string,
  search: string,
  replace: string
): Promise<ApplyResult> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read file: ${(err as Error).message}` };
  }
  const occurrences = source.split(search).length - 1;
  if (occurrences !== 1) {
    return { ok: false, reason: `search matched ${occurrences} times, expected exactly 1` };
  }
  const patched = source.replace(search, replace);
  await writeFile(filePath, patched, "utf8");
  return { ok: true };
}
