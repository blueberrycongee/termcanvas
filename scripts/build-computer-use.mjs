import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const outputDir = path.join(root, "dist-computer-use");
const mcpOutputDir = path.join(outputDir, "mcp-computer-use-server");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function read(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf-8",
    ...options,
  }).trim();
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(mcpOutputDir, { recursive: true });

run(pnpm, ["--filter", "termcanvas-computer-use-mcp", "build"]);
fs.cpSync(
  path.join(root, "mcp", "computer-use-server", "dist"),
  mcpOutputDir,
  { recursive: true },
);

if (process.platform === "darwin") {
  const swiftArgs = [
    "build",
    "-c",
    "release",
    "--arch",
    "arm64",
    "--arch",
    "x86_64",
    "--package-path",
    "native/computer-use-helper",
  ];
  run("swift", swiftArgs);
  const binPath = read("swift", [...swiftArgs, "--show-bin-path"]);
  fs.copyFileSync(
    path.join(binPath, "computer-use-helper"),
    path.join(outputDir, "computer-use-helper"),
  );
  run("codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    "com.blueberrycongee.termcanvas.computer-use-helper",
    "--options",
    "runtime",
    path.join(outputDir, "computer-use-helper"),
  ]);
}
