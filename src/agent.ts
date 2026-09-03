import { spawn } from "node:child_process";
import type { AgentConfig } from "./config.js";

export class AgentError extends Error {}

function getField(obj: unknown, field: string): unknown {
  const parts = field.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Runs the agent CLI, writing `prompt` to stdin and collecting stdout. */
export function runAgentProcess(agent: AgentConfig, prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(agent.command, agent.args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(new AgentError(`failed to run "${agent.command}": ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AgentError(`${agent.command} exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.on("error", () => {
      /* the agent CLI may close stdin early; ignore EPIPE */
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Extracts the text payload from the agent CLI's own JSON envelope, using
 * the configured `responseField` (dotted path). Falls back to raw stdout
 * if the envelope cannot be parsed as JSON.
 */
export function extractResponseText(stdout: string, responseField: string): string {
  const trimmed = stdout.trim();
  try {
    const envelope = JSON.parse(trimmed);
    const field = getField(envelope, responseField);
    if (typeof field === "string") return field;
    if (field !== undefined) return JSON.stringify(field);
  } catch {
    // envelope wasn't JSON at all; treat stdout itself as the payload
  }
  return trimmed;
}

/**
 * Defensively finds and parses a JSON value embedded in arbitrary model
 * output: fenced code blocks, leading/trailing prose, etc. Returns
 * `undefined` if nothing parseable is found.
 */
export function extractJson(text: string): unknown {
  const attempts: string[] = [];
  attempts.push(text.trim());

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());

  const firstBracket = text.search(/[[{]/);
  if (firstBracket !== -1) {
    const open = text[firstBracket];
    const close = open === "[" ? "]" : "}";
    const lastClose = text.lastIndexOf(close);
    if (lastClose > firstBracket) {
      attempts.push(text.slice(firstBracket, lastClose + 1).trim());
    }
  }

  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function invokeAgent(agent: AgentConfig, prompt: string, cwd: string): Promise<unknown> {
  const stdout = await runAgentProcess(agent, prompt, cwd);
  const text = extractResponseText(stdout, agent.responseField);
  const parsed = extractJson(text);
  if (parsed === undefined) {
    throw new AgentError("could not find JSON in the agent's response");
  }
  return parsed;
}

export async function isOnPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    const child = spawn(probe, [command]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
