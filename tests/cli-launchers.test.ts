import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureCliLauncher,
  getCliLauncherPath,
  getWindowsCliLauncherContent,
} from "../electron/cli-launchers.ts";

test("getCliLauncherPath uses extensionless launcher on unix", () => {
  assert.equal(
    getCliLauncherPath("/tmp/dist-cli/hydra.js", "darwin"),
    "/tmp/dist-cli/hydra",
  );
});

test("getCliLauncherPath uses cmd launcher on windows", () => {
  assert.equal(
    getCliLauncherPath("C:\\dist-cli\\hydra.js", "win32"),
    "C:\\dist-cli\\hydra.cmd",
  );
});

test("getWindowsCliLauncherContent targets the bundled js file", () => {
  assert.equal(
    getWindowsCliLauncherContent("C:\\dist-cli\\hydra.js"),
    '@echo off\r\nnode "%~dp0\\hydra.js" %*\r\n',
  );
});

test(
  "ensureCliLauncher creates a symlink on unix",
  { skip: process.platform === "win32" },
  () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-launcher-unix-"));
  const jsPath = path.join(dir, "hydra.js");
  fs.writeFileSync(jsPath, "#!/usr/bin/env node\n");

  ensureCliLauncher(jsPath, "darwin");

  const linkPath = path.join(dir, "hydra");
  const stat = fs.lstatSync(linkPath);
  assert.equal(stat.isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(linkPath), "hydra.js");

  fs.rmSync(dir, { recursive: true, force: true });
  },
);

test("ensureCliLauncher creates a cmd shim and removes stale unix launcher on windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-launcher-win-"));
  const jsPath = path.join(dir, "hydra.js");
  const staleUnixLauncher = path.join(dir, "hydra");
  fs.writeFileSync(jsPath, "#!/usr/bin/env node\r\n");
  fs.writeFileSync(staleUnixLauncher, "stale");

  ensureCliLauncher(jsPath, "win32");

  assert.equal(fs.existsSync(staleUnixLauncher), false);
  assert.equal(
    fs.readFileSync(path.join(dir, "hydra.cmd"), "utf-8"),
    '@echo off\r\nnode "%~dp0\\hydra.js" %*\r\n',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
