import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ProjectScanner } from "../electron/project-scanner.ts";

test("listChildGitRepos returns direct child repositories only", async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "termcanvas-project-scanner-"));
  const scanner = new ProjectScanner();

  try {
    const frontendDir = path.join(rootDir, "frontend");
    const backendDir = path.join(rootDir, "backend");
    const docsDir = path.join(rootDir, "docs");
    const nestedDir = path.join(docsDir, "nested-repo");

    mkdirSync(frontendDir);
    mkdirSync(backendDir);
    mkdirSync(docsDir);
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(path.join(rootDir, ".hidden-repo"));
    mkdirSync(path.join(rootDir, "node_modules"));

    execFileSync("git", ["init"], { cwd: frontendDir, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: backendDir, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: nestedDir, stdio: "ignore" });
    execFileSync("git", ["init"], {
      cwd: path.join(rootDir, ".hidden-repo"),
      stdio: "ignore",
    });
    writeFileSync(path.join(rootDir, "README.md"), "root");

    const repos = scanner.listChildGitRepos(rootDir);

    assert.deepEqual(repos, [
      { name: "backend", path: backendDir },
      { name: "frontend", path: frontendDir },
    ]);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});
