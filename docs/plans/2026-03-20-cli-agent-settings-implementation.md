# CLI Agent Settings Phase 1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users configure CLI agent commands (claude, codex, etc.) in Settings, with auto-detection and actionable errors when resolution fails.

**Architecture:** Add `cliCommands` to the existing preferences store (localStorage). A new "Agents" tab in Settings shows auto-detected status and accepts overrides. The `getTerminalLaunchOptions()` function accepts an optional override. `pty-launch.ts` throws a structured error. A new `cli:validate-command` IPC validates commands from the renderer. A tiny zustand store lets any component open the Settings modal to a specific tab.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, node:test

---

### Task 1: Add i18n keys

**Files:**
- Modify: `src/i18n/en.ts:141-145` (after existing CLI keys)
- Modify: `src/i18n/zh.ts:139-143` (after existing CLI keys)

**Step 1: Add English keys**

In `src/i18n/en.ts`, after line 145 (`cli_registering`), add:

```typescript
  // CLI Agent Settings
  settings_agents: "Agents",
  agent_status_found: (version: string) => `Found (${version})`,
  agent_status_not_found: "Not found",
  agent_status_checking: "Checking\u2026",
  agent_validate: "Validate",
  agent_command_placeholder: (detectedPath: string) => detectedPath,
  agent_default_hint: "Leave empty to use default",
  cli_launch_error_title: (command: string) =>
    `${command} CLI is not configured or cannot be launched.`,
  cli_launch_error_action: "Open Settings",
```

**Step 2: Add Chinese keys**

In `src/i18n/zh.ts`, after line 143 (`cli_registering`), add:

```typescript
  // CLI Agent Settings
  settings_agents: "Agent",
  agent_status_found: (version: string) => `已找到 (${version})`,
  agent_status_not_found: "未找到",
  agent_status_checking: "检测中…",
  agent_validate: "验证",
  agent_command_placeholder: (detectedPath: string) => detectedPath,
  agent_default_hint: "留空使用默认值",
  cli_launch_error_title: (command: string) =>
    `${command} CLI 未配置或无法启动。`,
  cli_launch_error_action: "打开设置",
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to i18n keys (both locale files must have identical key sets due to `as const` + type checking).

**Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add i18n keys for CLI agent settings"
```

---

### Task 2: Add cliCommands to preferencesStore

**Files:**
- Modify: `src/stores/preferencesStore.ts`
- Modify: `tests/preferences-store.test.ts`

**Step 1: Write the failing test**

Append to `tests/preferences-store.test.ts`:

```typescript
test("preferences stores and retrieves cliCommands", async () => {
  installLocalStorage();

  const { usePreferencesStore } = await loadPreferencesStoreModule("cli-commands");
  const store = usePreferencesStore.getState();

  // Defaults to empty
  assert.deepEqual(store.cliCommands, {});

  // Set a CLI command
  store.setCli("claude", { command: "/usr/local/bin/claude", args: [] });
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  // Persists to localStorage
  const raw = JSON.parse(localStorage.getItem("termcanvas-preferences")!);
  assert.deepEqual(raw.cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  // Clear by passing null
  store.setCli("claude", null);
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {});
});
```

**Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/preferences-store.test.ts 2>&1 | tail -5`
Expected: FAIL — `store.cliCommands` is undefined, `store.setCli` is not a function.

**Step 3: Implement in preferencesStore.ts**

Add the `CliCommandConfig` type and extend the store. The key changes:

1. Import `TerminalType` from `../types` at the top.

2. Add after line 5 (`const LEGACY_ENABLED_BLUR = 1.5;`):

```typescript
export interface CliCommandConfig {
  command: string;
  args: string[];
}
```

3. Add to `PreferencesStore` interface (after `composerEnabled`):

```typescript
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
  setCli: (type: TerminalType, config: CliCommandConfig | null) => void;
```

4. In `loadPreferences()`, add parsing for `cliCommands`:

```typescript
      let cliCommands: Partial<Record<string, CliCommandConfig>> = {};
      if (parsed.cliCommands && typeof parsed.cliCommands === "object") {
        for (const [key, val] of Object.entries(parsed.cliCommands)) {
          if (val && typeof val === "object" && "command" in val && typeof (val as Record<string, unknown>).command === "string") {
            cliCommands[key] = val as CliCommandConfig;
          }
        }
      }
```

Return it alongside existing fields. Update the return type and default return accordingly.

5. In `savePreferences()`, include `cliCommands` in the serialized object.

6. In the zustand `create()` call, add initial state and setter:

```typescript
  cliCommands: initialPrefs.cliCommands,
  setCli: (type, config) => {
    const current = { ...get().cliCommands };
    if (config) {
      current[type] = config;
    } else {
      delete current[type];
    }
    set({ cliCommands: current });
    savePreferences({ ...get(), cliCommands: current });
  },
```

**Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/preferences-store.test.ts 2>&1 | tail -5`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add src/stores/preferencesStore.ts tests/preferences-store.test.ts
git commit -m "feat: add cliCommands to preferences store"
```

---

### Task 3: Add cliOverride parameter to getTerminalLaunchOptions

**Files:**
- Modify: `src/terminal/cliConfig.ts:208-226`
- Modify: `tests/terminal-adapters.test.ts`

**Step 1: Write the failing test**

Append to `tests/terminal-adapters.test.ts`:

```typescript
test("getTerminalLaunchOptions applies cliOverride command", () => {
  const result = getTerminalLaunchOptions("claude", undefined, false, {
    command: "/custom/bin/claude",
    args: [],
  });
  assert.ok(result);
  assert.equal(result.shell, "/custom/bin/claude");
  assert.deepEqual(result.args, []);
});

test("getTerminalLaunchOptions prepends cliOverride args", () => {
  const result = getTerminalLaunchOptions("claude", "session-1", false, {
    command: "claude",
    args: ["--extra"],
  });
  assert.ok(result);
  assert.equal(result.shell, "claude");
  assert.deepEqual(result.args, ["--extra", "--resume", "session-1"]);
});
```

**Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/terminal-adapters.test.ts 2>&1 | tail -5`
Expected: FAIL — 4th parameter not accepted / ignored.

**Step 3: Implement**

In `src/terminal/cliConfig.ts`, first add the import at the top:

```typescript
import type { CliCommandConfig } from "../stores/preferencesStore";
```

Then modify `getTerminalLaunchOptions` (line 208+):

```typescript
export function getTerminalLaunchOptions(
  type: TerminalType,
  sessionId: string | undefined,
  autoApprove?: boolean,
  cliOverride?: CliCommandConfig,
): { shell: string; args: string[] } | null {
  const config = TERMINAL_CONFIG[type].launch;
  if (!config) return null;

  const shell = cliOverride?.command || config.shell;
  const extraArgs = cliOverride?.args ?? [];
  const base = sessionId ? config.resumeArgs(sessionId) : config.newArgs();
  const extra =
    autoApprove && !sessionId && config.autoApproveArgs
      ? config.autoApproveArgs()
      : [];

  return {
    shell,
    args: [...extraArgs, ...extra, ...base],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/terminal-adapters.test.ts 2>&1 | tail -5`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add src/terminal/cliConfig.ts tests/terminal-adapters.test.ts
git commit -m "feat: add cliOverride parameter to getTerminalLaunchOptions"
```

---

### Task 4: Structured error in pty-launch.ts

**Files:**
- Modify: `electron/pty-launch.ts:386-392`
- Modify: `tests/pty-launch.test.ts:174-188`

**Step 1: Update the failing test**

In `tests/pty-launch.test.ts`, replace the existing "throws a clear error" test (line 174-188) with:

```typescript
test("buildLaunchSpec throws PtyLaunchError when a CLI executable cannot be resolved", async () => {
  try {
    await buildLaunchSpec(
      {
        cwd: "/repo",
        shell: "codex",
      },
      createDeps({
        existsSync: (file) => file === "/repo" || file === "/bin/zsh",
      }),
    );
    assert.fail("Expected PtyLaunchError");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.equal((err as any).code, "executable-not-found");
    assert.equal((err as any).command, "codex");
    assert.match(err.message, /codex/);
  }
});
```

Also add the import of `PtyLaunchError` to the imports at line 5-9:

```typescript
import {
  buildLaunchSpec,
  sanitizeEnv,
  PtyLaunchError,
  type LaunchResolverDeps,
} from "../electron/pty-launch.ts";
```

**Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/pty-launch.test.ts 2>&1 | tail -10`
Expected: FAIL — `PtyLaunchError` is not exported / `err.code` is undefined.

**Step 3: Implement PtyLaunchError**

In `electron/pty-launch.ts`, add the class before `buildLaunchSpec` (e.g. after line 360, before `export async function buildLaunchSpec`):

```typescript
export class PtyLaunchError extends Error {
  readonly code: string;
  readonly command: string;

  constructor(code: string, message: string, command: string) {
    super(message);
    this.name = "PtyLaunchError";
    this.code = code;
    this.command = command;
  }
}
```

Then update the throw in `buildLaunchSpec` (line 388-391) from:

```typescript
      throw new Error(
        `Executable not found: ${options.shell} (PATH=${shellEnv.PATH ?? ""})`,
      );
```

to:

```typescript
      throw new PtyLaunchError(
        "executable-not-found",
        `Executable not found: ${options.shell}`,
        options.shell,
      );
```

**Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/pty-launch.test.ts 2>&1 | tail -5`
Expected: All tests PASS (including the updated one).

**Step 5: Commit**

```bash
git add electron/pty-launch.ts tests/pty-launch.test.ts
git commit -m "feat: throw structured PtyLaunchError for executable resolution failures"
```

---

### Task 5: Add cli:validate-command IPC

**Files:**
- Modify: `electron/main.ts` (add IPC handler in `setupIpc()`)
- Modify: `electron/preload.ts:119-126` (add `validateCommand` to `cli` namespace)

**Step 1: Add IPC handler in main.ts**

Find the existing `cli:register` / `cli:unregister` handlers in `electron/main.ts` (search for `cli:is-registered`). Add the new handler nearby:

```typescript
  ipcMain.handle(
    "cli:validate-command",
    async (_event, command: string, _args?: string[]) => {
      try {
        const { buildLaunchSpec } = await import("./pty-launch.js");
        // Build a launch spec to resolve the command using the same
        // PATH + shell env logic as real terminal creation.
        const spec = await buildLaunchSpec({
          cwd: process.cwd(),
          shell: command,
          extraPathEntries: [getCliDir()],
        });
        // Try to get version
        const { execFile } = await import("child_process");
        const version = await new Promise<string | null>((resolve) => {
          execFile(
            spec.file,
            ["--version"],
            { timeout: 5000, env: spec.env },
            (err, stdout) => {
              if (err) { resolve(null); return; }
              const line = stdout.toString().trim().split("\n")[0];
              resolve(line || null);
            },
          );
        });
        return { ok: true as const, resolvedPath: spec.file, version };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
```

**Step 2: Add preload bridge**

In `electron/preload.ts`, inside the `cli` object (after line 125, `unregister`), add:

```typescript
    validateCommand: (command: string, args?: string[]) =>
      ipcRenderer.invoke("cli:validate-command", command, args) as Promise<
        | { ok: true; resolvedPath: string; version: string | null }
        | { ok: false; error: string }
      >,
```

**Step 3: Run type check**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

**Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: add cli:validate-command IPC for agent CLI resolution"
```

---

### Task 6: Create settings modal store

The existing Settings modal is controlled by local state in `Toolbar.tsx`. To let `TerminalTile.tsx` (the error panel) open Settings to the Agents tab, extract this into a tiny zustand store.

**Files:**
- Create: `src/stores/settingsModalStore.ts`
- Modify: `src/toolbar/Toolbar.tsx` (consume store instead of local state)

**Step 1: Create the store**

```typescript
import { create } from "zustand";

type SettingsTab = "general" | "shortcuts" | "agents";

interface SettingsModalStore {
  open: boolean;
  initialTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

export type { SettingsTab };

export const useSettingsModalStore = create<SettingsModalStore>((set) => ({
  open: false,
  initialTab: "general",
  openSettings: (tab = "general") => set({ open: true, initialTab: tab }),
  closeSettings: () => set({ open: false }),
}));
```

**Step 2: Update Toolbar.tsx**

In `src/toolbar/Toolbar.tsx`:

1. Add import: `import { useSettingsModalStore } from "../stores/settingsModalStore";`
2. Replace line 25 (`const [showSettings, setShowSettings] = useState(false);`) with:
   ```typescript
   const showSettings = useSettingsModalStore((s) => s.open);
   const openSettings = useSettingsModalStore((s) => s.openSettings);
   const closeSettings = useSettingsModalStore((s) => s.closeSettings);
   ```
3. Replace `setShowSettings(true)` (line 204) with `openSettings()`.
4. Replace `setShowSettings(false)` in the `SettingsModal onClose` prop (line 275) with `closeSettings`.

**Step 3: Update SettingsModal.tsx**

In `src/components/SettingsModal.tsx`:

1. Add import: `import { useSettingsModalStore, type SettingsTab } from "../stores/settingsModalStore";`
2. Change the `Tab` type (line 23) to: `type Tab = SettingsTab;`
3. Update `useState<Tab>("general")` (line 87) to use the store's `initialTab`:
   ```typescript
   const initialTab = useSettingsModalStore((s) => s.initialTab);
   const [tab, setTab] = useState<Tab>(initialTab);
   ```

**Step 4: Verify app compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/stores/settingsModalStore.ts src/toolbar/Toolbar.tsx src/components/SettingsModal.tsx
git commit -m "refactor: extract settings modal state into a zustand store"
```

---

### Task 7: Agents tab in SettingsModal

**Files:**
- Modify: `src/components/SettingsModal.tsx`

**Step 1: Add the Agents tab button**

In the tabs section (around line 186-199), add a third button after the Shortcuts tab button:

```tsx
          <button
            className={tabBtn(tab === "agents")}
            onClick={() => setTab("agents")}
          >
            {t.settings_agents}
          </button>
```

**Step 2: Implement the Agents tab content**

After the shortcuts tab content block (after line 456 `)}` that closes `tab === "shortcuts"`), add:

```tsx
          {tab === "agents" && <AgentsTabContent />}
```

Then create the `AgentsTabContent` component above `SettingsModal` in the same file. The 5 configurable agents are: `claude`, `codex`, `kimi`, `gemini`, `opencode`.

```tsx
const AGENT_TYPES = ["claude", "codex", "kimi", "gemini", "opencode"] as const;

function AgentsTabContent() {
  const t = useT();
  const { cliCommands, setCli } = usePreferencesStore();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<
    Record<string, { ok: true; resolvedPath: string; version: string | null } | { ok: false; error: string } | null>
  >({});

  // Auto-detect on mount
  useEffect(() => {
    for (const agent of AGENT_TYPES) {
      const command = cliCommands[agent]?.command ?? agent;
      setStatuses((prev) => ({ ...prev, [agent]: null })); // null = checking
      window.termcanvas.cli.validateCommand(command).then((result) => {
        setStatuses((prev) => ({ ...prev, [agent]: result }));
      });
    }
  }, []);

  const handleValidate = (agent: string) => {
    const command = drafts[agent]?.trim() || cliCommands[agent]?.command || agent;
    setStatuses((prev) => ({ ...prev, [agent]: null }));
    window.termcanvas.cli.validateCommand(command).then((result) => {
      setStatuses((prev) => ({ ...prev, [agent]: result }));
    });
  };

  const handleSave = (agent: string) => {
    const command = drafts[agent]?.trim();
    if (command) {
      setCli(agent as any, { command, args: [] });
    } else {
      setCli(agent as any, null);
    }
    handleValidate(agent);
  };

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] text-[var(--text-muted)] mb-2">
        {t.agent_default_hint}
      </p>
      {AGENT_TYPES.map((agent) => {
        const status = statuses[agent];
        const saved = cliCommands[agent]?.command;
        const draft = drafts[agent] ?? saved ?? "";

        return (
          <div
            key={agent}
            className="flex items-center gap-2 py-2 border-b border-[var(--border)]"
          >
            <span className="text-[13px] text-[var(--text-primary)] w-20 shrink-0 capitalize">
              {agent}
            </span>

            <input
              type="text"
              className="flex-1 min-w-0 px-2 py-1 rounded-md text-[13px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              placeholder={
                status && status.ok
                  ? t.agent_command_placeholder(status.resolvedPath)
                  : agent
              }
              value={draft}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [agent]: e.target.value }))
              }
              onBlur={() => handleSave(agent)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave(agent);
              }}
            />

            <button
              className="px-2 py-1 rounded-md text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--surface)] hover:bg-[var(--border)] transition-colors duration-100 shrink-0"
              onClick={() => handleValidate(agent)}
            >
              {t.agent_validate}
            </button>

            <span
              className={`text-[11px] shrink-0 min-w-[80px] text-right ${
                status === null
                  ? "text-[var(--text-muted)]"
                  : status.ok
                    ? "text-[var(--green,#4ade80)]"
                    : "text-[var(--red,#f87171)]"
              }`}
            >
              {status === null
                ? t.agent_status_checking
                : status.ok
                  ? t.agent_status_found(status.version ?? "unknown")
                  : t.agent_status_not_found}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 3: Increase modal min-height slightly**

The content area (line 202) has `min-h-[280px]`. The Agents tab has 5 rows + a description, which is about the same height. No change needed unless it overflows during testing.

**Step 4: Verify app compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: add Agents tab to Settings with auto-detect and validation"
```

---

### Task 8: Wire cliOverride into TerminalTile + actionable error

**Files:**
- Modify: `src/terminal/TerminalTile.tsx:327-425`

**Step 1: Add imports**

Add at the top of TerminalTile.tsx:

```typescript
import { usePreferencesStore } from "../stores/preferencesStore";
import { useSettingsModalStore } from "../stores/settingsModalStore";
```

**Step 2: Read cliOverride in the effect**

Inside the `useEffect` that creates the terminal (the one containing `spawnPty`), read the CLI override. Right before `const spawnPty = ...` (around line 327):

```typescript
    const cliOverride = usePreferencesStore.getState().cliCommands[terminal.type] ?? undefined;
```

**Step 3: Pass cliOverride to getTerminalLaunchOptions**

At line 333-336, change:

```typescript
      const launch = getTerminalLaunchOptions(
        terminal.type,
        resumeSessionId,
        terminal.autoApprove,
      );
```

to:

```typescript
      const launch = getTerminalLaunchOptions(
        terminal.type,
        resumeSessionId,
        terminal.autoApprove,
        cliOverride,
      );
```

**Step 4: Improve the error handler**

Replace the `.catch` block (around lines 419-425) with an actionable error that detects `executable-not-found`:

```typescript
        .catch((err) => {
          const errStr = err instanceof Error ? err.message : String(err);
          const isNotFound =
            errStr.includes("Executable not found") ||
            errStr.includes("executable-not-found");

          notify("error", t.failed_create_pty(displayTitleRef.current, errStr));
          updateTerminalStatus(projectId, worktreeId, terminal.id, "error");

          if (isNotFound) {
            const command = launch?.shell ?? terminal.type;
            xterm.write(
              `\r\n\x1b[31m${t.cli_launch_error_title(command)}\x1b[0m\r\n` +
              `\r\n\x1b[33m${t.cli_launch_error_action}: Settings > Agents\x1b[0m\r\n`,
            );
          } else {
            xterm.write(
              `\r\n\x1b[31m[Error] Failed to create terminal: ${errStr}\x1b[0m\r\n`,
            );
          }
        });
```

> Note: The error message references `launch` which is defined within the `spawnPty` closure scope, so it's accessible. If `launch` is null (shell type), this path can't trigger `executable-not-found` anyway, so the fallback uses `terminal.type`.

**Step 5: Verify app compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No type errors.

**Step 6: Commit**

```bash
git add src/terminal/TerminalTile.tsx
git commit -m "feat: wire CLI override from preferences + actionable error on launch failure"
```

---

### Task 9: Run full test suite

**Step 1: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass, including the new ones added in Tasks 2-4.

**Step 2: Run type check**

Run: `npx tsc --noEmit --pretty`
Expected: No errors.

**Step 3: If anything fails, fix and re-commit**

---

### Task 10: Manual smoke test

Verify the following by running the dev app (`npm run dev`):

1. Open Settings > Agents tab. All 5 agents should show detection status.
2. Enter a bad path like `/nonexistent/claude`, click Validate. Should show "Not found".
3. Clear the input, click Validate. Should fall back to default and re-detect.
4. Try creating a claude terminal without `claude` on PATH. Should show the actionable error message in the terminal area, not the raw `Executable not found` string.
5. Existing terminal creation (shell, lazygit, etc.) should be unaffected.
