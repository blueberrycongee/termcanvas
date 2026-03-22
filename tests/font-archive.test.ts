import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractFileFromZip } from "../electron/font-archive.ts";

test("extractFileFromZip extracts a nested font file on Windows", () => {
  if (process.platform !== "win32") return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "font-archive-"));
  const sourceDir = path.join(dir, "source");
  const nestedDir = path.join(sourceDir, "nested");
  const destinationDir = path.join(dir, "fonts");
  const zipPath = path.join(dir, "font.zip");
  const fileName = "TestFont.ttf";
  const fileContent = "demo-font";

  fs.mkdirSync(nestedDir, { recursive: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.writeFileSync(path.join(nestedDir, fileName), fileContent, "utf-8");

  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${path.join(sourceDir, "*").replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
    ],
    { stdio: "pipe" },
  );

  const extractedPath = extractFileFromZip(zipPath, fileName, destinationDir);

  assert.equal(extractedPath, path.join(destinationDir, fileName));
  assert.equal(fs.readFileSync(extractedPath, "utf-8"), fileContent);

  fs.rmSync(dir, { recursive: true, force: true });
});
