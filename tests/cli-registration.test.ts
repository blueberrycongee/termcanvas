import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import type {
  CliRegistrationDeps,
  WindowsRegistryPathValue,
} from "../electron/cli-registration.ts";
import {
  addWindowsPathEntry,
  hasWindowsPathEntry,
  isCliRegistered,
  normalizeWindowsPathForComparison,
  registerCli,
  removeWindowsPathEntry,
  unregisterCli,
} from "../electron/cli-registration.ts";

const CLI_DIR = "C:\\Users\\test\\AppData\\Local\\Programs\\TermCanvas\\cli";

function createWindowsDeps(
  initialRegistryValue: WindowsRegistryPathValue | null,
): {
  deps: Partial<CliRegistrationDeps>;
  state: {
    registryValue: WindowsRegistryPathValue | null;
    writeCalls: Array<{ value: string; type: string }>;
    deleteCalls: number;
    broadcastCalls: number;
    launcherCalls: Array<{ jsPath: string; platform?: NodeJS.Platform }>;
    chmodCalls: string[];
  };
} {
  const state = {
    registryValue: initialRegistryValue,
    writeCalls: [] as Array<{ value: string; type: string }>,
    deleteCalls: 0,
    broadcastCalls: 0,
    launcherCalls: [] as Array<{ jsPath: string; platform?: NodeJS.Platform }>,
    chmodCalls: [] as string[],
  };

  return {
    deps: {
      platform: "win32",
      homedir: () => "C:\\Users\\test",
      chmodSync: (filePath) => {
        state.chmodCalls.push(filePath);
      },
      ensureCliLauncher: (jsPath, platform) => {
        state.launcherCalls.push({ jsPath, platform });
      },
      readWindowsUserPath: () =>
        state.registryValue ? { ...state.registryValue } : null,
      writeWindowsUserPath: (value, type) => {
        state.registryValue = { value, type };
        state.writeCalls.push({ value, type });
      },
      deleteWindowsUserPath: () => {
        state.registryValue = null;
        state.deleteCalls += 1;
      },
      broadcastEnvironmentChange: () => {
        state.broadcastCalls += 1;
      },
    },
    state,
  };
}

test("normalizeWindowsPathForComparison ignores case, quotes, and trailing slash", () => {
  assert.equal(
    normalizeWindowsPathForComparison(`"${CLI_DIR.toUpperCase()}\\\\"`),
    CLI_DIR.toLowerCase(),
  );
});

test("hasWindowsPathEntry matches existing PATH entries case-insensitively", () => {
  const pathValue = `C:\\Tools;${CLI_DIR.toUpperCase()}\\;D:\\Bin`;
  assert.equal(hasWindowsPathEntry(pathValue, CLI_DIR), true);
});

test("addWindowsPathEntry appends the CLI dir when PATH is missing", () => {
  assert.equal(addWindowsPathEntry(null, CLI_DIR), CLI_DIR);
  assert.equal(addWindowsPathEntry("", CLI_DIR), CLI_DIR);
});

test("addWindowsPathEntry does not duplicate an existing normalized PATH entry", () => {
  const existing = `C:\\Tools;"${CLI_DIR}\\\\"`;
  assert.equal(addWindowsPathEntry(existing, CLI_DIR), existing);
});

test("removeWindowsPathEntry removes only the target directory", () => {
  const pathValue = `C:\\Tools;${CLI_DIR};D:\\Bin`;
  assert.equal(removeWindowsPathEntry(pathValue, CLI_DIR), "C:\\Tools;D:\\Bin");
});

test("removeWindowsPathEntry returns null when removing the only entry", () => {
  assert.equal(removeWindowsPathEntry(`${CLI_DIR}\\`, CLI_DIR), null);
});

test("isCliRegistered reads the Windows user PATH from the registry", () => {
  const { deps } = createWindowsDeps({
    type: "REG_EXPAND_SZ",
    value: `C:\\Tools;${CLI_DIR.toUpperCase()}\\`,
  });

  assert.equal(isCliRegistered(CLI_DIR, deps), true);
});

test("registerCli writes the CLI dir into the Windows user PATH and preserves type", () => {
  const { deps, state } = createWindowsDeps({
    type: "REG_SZ",
    value: "C:\\Tools",
  });

  assert.equal(registerCli(CLI_DIR, deps), true);
  assert.deepEqual(state.writeCalls, [
    { type: "REG_SZ", value: `C:\\Tools;${CLI_DIR}` },
  ]);
  assert.equal(state.broadcastCalls, 1);
  assert.deepEqual(
    state.launcherCalls,
    [
      {
        jsPath: path.win32.join(CLI_DIR, "termcanvas.js"),
        platform: "win32",
      },
      {
        jsPath: path.win32.join(CLI_DIR, "hydra.js"),
        platform: "win32",
      },
      {
        jsPath: path.win32.join(CLI_DIR, "browse.js"),
        platform: "win32",
      },
    ],
  );
});

test("registerCli is idempotent when the CLI dir is already present", () => {
  const { deps, state } = createWindowsDeps({
    type: "REG_EXPAND_SZ",
    value: `C:\\Tools;${CLI_DIR.toUpperCase()}\\`,
  });

  assert.equal(registerCli(CLI_DIR, deps), true);
  assert.equal(state.writeCalls.length, 0);
  assert.equal(state.broadcastCalls, 1);
});

test("unregisterCli removes only the CLI dir from the Windows user PATH", () => {
  const { deps, state } = createWindowsDeps({
    type: "REG_EXPAND_SZ",
    value: `C:\\Tools;${CLI_DIR};D:\\Bin`,
  });

  assert.equal(unregisterCli(CLI_DIR, deps), true);
  assert.deepEqual(state.writeCalls, [
    { type: "REG_EXPAND_SZ", value: "C:\\Tools;D:\\Bin" },
  ]);
  assert.equal(state.deleteCalls, 0);
  assert.equal(state.broadcastCalls, 1);
});

test("unregisterCli deletes the Windows user PATH value when it becomes empty", () => {
  const { deps, state } = createWindowsDeps({
    type: "REG_EXPAND_SZ",
    value: CLI_DIR,
  });

  assert.equal(unregisterCli(CLI_DIR, deps), true);
  assert.equal(state.deleteCalls, 1);
  assert.equal(state.registryValue, null);
  assert.equal(state.broadcastCalls, 1);
});
