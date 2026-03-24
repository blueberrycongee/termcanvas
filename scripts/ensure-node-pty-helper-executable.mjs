import fs from "node:fs";
import path from "node:path";

function ensureExecutable(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const executableMask = 0o111;
    if ((stat.mode & executableMask) === executableMask) {
      return;
    }

    fs.chmodSync(filePath, stat.mode | executableMask);
    console.log(`[node-pty] restored execute bit on ${filePath}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[node-pty] failed to ensure helper is executable: ${detail}`);
  }
}

if (process.platform === "darwin") {
  const helperPath = path.resolve(
    process.cwd(),
    "node_modules",
    "node-pty",
    "prebuilds",
    "darwin-arm64",
    "spawn-helper",
  );

  if (fs.existsSync(helperPath)) {
    ensureExecutable(helperPath);
  }
}
