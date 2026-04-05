import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import {
  readCliIntegrationState,
  syncCliIntegrationOnStartup,
  writeCliIntegrationState,
} from "../electron/cli-integration.ts";

test("readCliIntegrationState defaults autoRegister to true when file is missing", () => {
  const filePath = path.join(os.tmpdir(), `missing-cli-integration-${Date.now()}.json`);
  assert.deepEqual(readCliIntegrationState(filePath), { autoRegister: true });
});

test("writeCliIntegrationState persists the explicit autoRegister choice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-integration-"));
  const filePath = path.join(dir, "cli-integration.json");

  writeCliIntegrationState({ autoRegister: false }, filePath);

  assert.deepEqual(readCliIntegrationState(filePath), { autoRegister: false });
});

test("syncCliIntegrationOnStartup ensures skills before auto-registering CLI", () => {
  const calls: string[] = [];

  syncCliIntegrationOnStartup({
    autoRegisterEnabled: true,
    cliRegistered: false,
    registerCli: () => {
      calls.push("register");
      return true;
    },
    ensureSkills: () => {
      calls.push("ensure");
      return true;
    },
    persistAutoRegisterEnabled: (enabled) => {
      calls.push(`persist:${enabled}`);
    },
  });

  assert.deepEqual(calls, ["ensure", "register", "persist:true"]);
});

test("syncCliIntegrationOnStartup only ensures skills when CLI is already registered", () => {
  const calls: string[] = [];

  syncCliIntegrationOnStartup({
    autoRegisterEnabled: true,
    cliRegistered: true,
    registerCli: () => {
      calls.push("register");
      return true;
    },
    ensureSkills: () => {
      calls.push("ensure");
      return true;
    },
    persistAutoRegisterEnabled: (enabled) => {
      calls.push(`persist:${enabled}`);
    },
  });

  assert.deepEqual(calls, ["ensure"]);
});

test("syncCliIntegrationOnStartup respects an explicit user opt-out", () => {
  const calls: string[] = [];

  syncCliIntegrationOnStartup({
    autoRegisterEnabled: false,
    cliRegistered: false,
    registerCli: () => {
      calls.push("register");
      return true;
    },
    ensureSkills: () => {
      calls.push("ensure");
      return true;
    },
    persistAutoRegisterEnabled: (enabled) => {
      calls.push(`persist:${enabled}`);
    },
  });

  assert.deepEqual(calls, ["ensure"]);
});
