import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applySearchReplace } from "../src/git.js";

async function withTempFile(contents: string, fn: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mole-git-test-"));
  const filePath = path.join(dir, "file.js");
  await writeFile(filePath, contents, "utf8");
  try {
    await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("applySearchReplace replaces a unique match", async () => {
  await withTempFile("const x = 1;\nconst y = 2;\n", async (filePath) => {
    const result = await applySearchReplace(filePath, "const x = 1;", "const x = 99;");
    assert.equal(result.ok, true);
    const contents = await readFile(filePath, "utf8");
    assert.equal(contents, "const x = 99;\nconst y = 2;\n");
  });
});

test("applySearchReplace fails when the search string does not appear", async () => {
  await withTempFile("const x = 1;\n", async (filePath) => {
    const result = await applySearchReplace(filePath, "const z = 1;", "const z = 2;");
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /matched 0 times/);
    const contents = await readFile(filePath, "utf8");
    assert.equal(contents, "const x = 1;\n"); // untouched
  });
});

test("applySearchReplace fails when the search string is ambiguous", async () => {
  await withTempFile("foo();\nfoo();\n", async (filePath) => {
    const result = await applySearchReplace(filePath, "foo();", "bar();");
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /matched 2 times/);
    const contents = await readFile(filePath, "utf8");
    assert.equal(contents, "foo();\nfoo();\n"); // untouched
  });
});

test("applySearchReplace reports a missing file without throwing", async () => {
  const result = await applySearchReplace("/nonexistent/path/file.js", "a", "b");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /cannot read file/);
});
