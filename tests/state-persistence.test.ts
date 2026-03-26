import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  getTermCanvasDataDir,
  resolveTermCanvasPortFile,
} from "../shared/termcanvas-instance.ts";

test("save writes atomically via tmp+rename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-state-"));
  const file = path.join(dir, "state.json");

  const data = { version: 1, projects: [] };
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);

  const loaded = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.deepEqual(loaded, data);
  assert.equal(fs.existsSync(tmp), false, "tmp file should be cleaned up by rename");

  fs.rmSync(dir, { recursive: true });
});

test("save with skipRestore flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-state-"));
  const file = path.join(dir, "state.json");

  const data = { version: 1, projects: [], skipRestore: true };
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);

  const loaded = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(loaded.skipRestore, true);

  fs.rmSync(dir, { recursive: true });
});

test("getTermCanvasDataDir separates prod and dev state directories", () => {
  assert.equal(
    getTermCanvasDataDir("prod"),
    path.join(os.homedir(), ".termcanvas"),
  );
  assert.equal(
    getTermCanvasDataDir("dev"),
    path.join(os.homedir(), ".termcanvas-dev"),
  );
});

test("resolveTermCanvasPortFile defaults to the prod instance port file", () => {
  assert.equal(
    resolveTermCanvasPortFile({}),
    path.join(os.homedir(), ".termcanvas", "port"),
  );
});

test("resolveTermCanvasPortFile respects TERMCANVAS_INSTANCE and TERMCANVAS_PORT_FILE", () => {
  assert.equal(
    resolveTermCanvasPortFile({ TERMCANVAS_INSTANCE: "dev" }),
    path.join(os.homedir(), ".termcanvas-dev", "port"),
  );
  assert.equal(
    resolveTermCanvasPortFile({
      TERMCANVAS_INSTANCE: "prod",
      TERMCANVAS_PORT_FILE: "/tmp/custom-port-file",
    }),
    "/tmp/custom-port-file",
  );
});
