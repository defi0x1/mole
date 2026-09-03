import { spawn } from "node:child_process";

export interface TestRunResult {
  passed: boolean;
  timedOut: boolean;
  crashed: boolean;
  output: string;
  durationMs: number;
}

/**
 * Environment variables Node's own test runner sets on itself. If mole is
 * invoked from inside a `node --test` process (its own test suite, or a CI
 * step that wraps it) and these leak into the spawned `testCommand`, a
 * nested `node --test` child mistakes itself for a subprocess of the outer
 * run and reports a false pass. Strip them so the child always runs as a
 * normal, independent process.
 */
const TEST_HARNESS_ENV_KEYS = ["NODE_TEST_CONTEXT"];

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of TEST_HARNESS_ENV_KEYS) delete env[key];
  return env;
}

/** Runs `testCommand` in `cwd` via the shell, enforcing a timeout. */
export function runTestCommand(cwd: string, testCommand: string, timeoutSec: number): Promise<TestRunResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(testCommand, {
      cwd,
      shell: true,
      env: cleanEnv(),
    });

    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ passed: false, timedOut: true, crashed: false, output, durationMs: Date.now() - start });
    }, timeoutSec * 1000);

    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output += `\n${err.message}`;
      resolve({ passed: false, timedOut: false, crashed: true, output, durationMs: Date.now() - start });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        passed: code === 0,
        timedOut: false,
        crashed: false,
        output,
        durationMs: Date.now() - start,
      });
    });
  });
}
