# Codex Hook Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Inject lifecycle hooks into Codex CLI so TermCanvas receives real-time tool/session events via Unix socket, eliminating the main-brain's false stall detection.

**Architecture:** Reuse the existing `termcanvas-hook.mjs` → `HookReceiver` → `TelemetryService` pipeline. Add Codex-specific config injection (`hooks.json` + feature flag) in `skill-manager.ts`, and fix the hardcoded `provider: "claude"` in `recordHookEvent`.

**Tech Stack:** TypeScript, Node.js fs, TOML (string-level manipulation — no library needed)

---

### Task 1: Add `getCodexConfigDir` and `getCodexHooksFile` helpers

**Files:**
- Modify: `electron/skill-manager.ts:18-20`

**Step 1: Write the failing test**

Add to `tests/skill-manager.test.ts`:

```typescript
test("installSkillLinks creates codex hooks.json with all 5 events", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hooksFile = path.join(home, ".codex", "hooks.json");
  assert.equal(fs.existsSync(hooksFile), true, "hooks.json not created");

  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]) {
    assert.ok(hooks.hooks[event], `missing hook event: ${event}`);
    assert.equal(hooks.hooks[event].length, 1);
    assert.ok(
      hooks.hooks[event][0].hooks[0].command.includes("termcanvas-hook.mjs"),
      `${event} hook command missing termcanvas-hook.mjs`,
    );
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "codex hooks.json"`
Expected: FAIL — hooks.json not created

**Step 3: Write minimal implementation**

In `electron/skill-manager.ts`, add path helper and `ensureCodexHooks` function:

```typescript
function getCodexConfigDir(home: string): string {
  return path.join(home, ".codex");
}

const CODEX_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "Stop",
  "UserPromptSubmit",
] as const;

function ensureCodexHooks(scriptPath: string, home: string): void {
  const hooksFile = path.join(getCodexConfigDir(home), "hooks.json");
  let data: { hooks?: Record<string, unknown[]> } = {};
  try {
    data = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  } catch {}

  const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
  const hookCommand = `node '${scriptPath}'`;

  for (const eventName of CODEX_HOOK_EVENTS) {
    const existing = (hooks[eventName] ?? []) as Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string; timeout?: number }>;
    }>;

    const filtered = existing.filter(
      (entry) => !entry.hooks?.some((h) => h.command.includes(LIFECYCLE_MARKER)),
    );

    filtered.push({
      matcher: "",
      hooks: [{ type: "command", command: hookCommand, timeout: 5 }],
    });

    hooks[eventName] = filtered;
  }

  data.hooks = hooks;

  const dir = path.dirname(hooksFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = hooksFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, hooksFile);
}
```

Then call it from `installSkillLinks` and `ensureSkillLinks`:

```typescript
// In installSkillLinks, after ensureLifecycleHooks:
ensureCodexHooks(
  path.join(sourceDir, "scripts", "termcanvas-hook.mjs"),
  home,
);

// In ensureSkillLinks, after ensureLifecycleHooks:
ensureCodexHooks(
  path.join(sourceDir, "scripts", "termcanvas-hook.mjs"),
  home,
);
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "codex hooks.json"`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/skill-manager.ts tests/skill-manager.test.ts
git commit -m "feat: inject Codex CLI hooks.json on skill install/ensure"
```

---

### Task 2: Add `removeCodexHooks` for uninstall path

**Files:**
- Modify: `electron/skill-manager.ts`
- Modify: `tests/skill-manager.test.ts`

**Step 1: Write the failing test**

```typescript
test("uninstallSkillLinks removes termcanvas entries from codex hooks.json", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hooksFile = path.join(home, ".codex", "hooks.json");
  assert.equal(fs.existsSync(hooksFile), true);

  uninstallSkillLinks({ home, sourceDir });

  // hooks.json should still exist but with no termcanvas entries
  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  for (const event of ["PreToolUse", "PostToolUse", "SessionStart", "Stop", "UserPromptSubmit"]) {
    const entries = hooks.hooks?.[event] ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        assert.ok(
          !h.command.includes("termcanvas-hook.mjs"),
          `${event} still has termcanvas hook after uninstall`,
        );
      }
    }
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "removes termcanvas entries"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
function removeCodexHooks(home: string): void {
  const hooksFile = path.join(getCodexConfigDir(home), "hooks.json");
  let data: { hooks?: Record<string, unknown[]> } = {};
  try {
    data = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  } catch {
    return;
  }

  const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
  let changed = false;

  for (const eventName of CODEX_HOOK_EVENTS) {
    const existing = (hooks[eventName] ?? []) as Array<{
      matcher?: string;
      hooks?: Array<{ type: string; command: string }>;
    }>;

    const filtered = existing.filter(
      (entry) => !entry.hooks?.some((h) => h.command.includes(LIFECYCLE_MARKER)),
    );

    if (filtered.length !== existing.length) {
      changed = true;
      if (filtered.length === 0) {
        delete hooks[eventName];
      } else {
        hooks[eventName] = filtered;
      }
    }
  }

  if (!changed) return;

  if (Object.keys(hooks).length === 0) {
    delete data.hooks;
  } else {
    data.hooks = hooks;
  }

  const tmp = hooksFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, hooksFile);
}
```

Call from `uninstallSkillLinks`:

```typescript
removeCodexHooks(home);
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "removes termcanvas entries"`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/skill-manager.ts tests/skill-manager.test.ts
git commit -m "feat: remove Codex hooks on skill uninstall"
```

---

### Task 3: Add `ensureCodexFeatureFlag` for config.toml

**Files:**
- Modify: `electron/skill-manager.ts`
- Modify: `tests/skill-manager.test.ts`

**Step 1: Write the failing test**

```typescript
test("installSkillLinks enables codex_hooks feature flag in config.toml", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const configFile = path.join(home, ".codex", "config.toml");
  assert.equal(fs.existsSync(configFile), true, "config.toml not created");

  const content = fs.readFileSync(configFile, "utf-8");
  assert.ok(content.includes("codex_hooks = true"), "codex_hooks flag not set");
});

test("ensureCodexFeatureFlag preserves existing config.toml content", () => {
  const { home, sourceDir } = makeTempEnv();

  const codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, "config.toml"),
    'model = "gpt-4"\n\n[features]\napply_patch = true\n',
  );

  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const content = fs.readFileSync(path.join(codexDir, "config.toml"), "utf-8");
  assert.ok(content.includes('model = "gpt-4"'), "existing model setting lost");
  assert.ok(content.includes("apply_patch = true"), "existing feature flag lost");
  assert.ok(content.includes("codex_hooks = true"), "codex_hooks not added");
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "codex_hooks feature flag"`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
function ensureCodexFeatureFlag(home: string): void {
  const configFile = path.join(getCodexConfigDir(home), "config.toml");
  fs.mkdirSync(path.dirname(configFile), { recursive: true });

  let content = "";
  try {
    content = fs.readFileSync(configFile, "utf-8");
  } catch {}

  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(content)) return;

  content = content.replace(/^\s*codex_hooks\s*=.*$/m, "").replace(/\n{3,}/g, "\n\n");

  const featuresMatch = content.match(/^\[features\]\s*$/m);
  if (featuresMatch) {
    const idx = featuresMatch.index! + featuresMatch[0].length;
    content = content.slice(0, idx) + "\ncodex_hooks = true" + content.slice(idx);
  } else {
    content = content.trimEnd() + "\n\n[features]\ncodex_hooks = true\n";
  }

  const tmp = configFile + ".tmp." + process.pid;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, configFile);
}
```

Call from `installSkillLinks` and `ensureSkillLinks` after `ensureCodexHooks`.

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/skill-manager.test.ts --test-name-pattern "codex_hooks|preserves existing"`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/skill-manager.ts tests/skill-manager.test.ts
git commit -m "feat: enable codex_hooks feature flag in config.toml"
```

---

### Task 4: Fix hardcoded `provider: "claude"` in `recordHookEvent`

**Files:**
- Modify: `electron/telemetry-service.ts:714-729`
- Modify: `tests/telemetry-service.test.ts`

**Step 1: Write the failing test**

```typescript
test("recordHookEvent SessionStart uses registered provider instead of hardcoded claude", () => {
  const service = createService();
  service.registerTerminal({
    terminalId: "t-codex",
    worktreePath: "/repo",
    provider: "codex",
    ptyId: 10,
    shellPid: 100,
  });

  service.recordHookEvent("t-codex", {
    hook_event_name: "SessionStart",
    session_id: "sess-codex-1",
    transcript_path: "/tmp/codex-session.jsonl",
  });

  const snap = service.getSnapshot("t-codex")!;
  assert.equal(snap.provider, "codex");
  assert.equal(snap.session_id, "sess-codex-1");
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/telemetry-service.test.ts --test-name-pattern "registered provider"`
Expected: FAIL — provider is "claude" instead of "codex"

**Step 3: Write minimal implementation**

In `electron/telemetry-service.ts:714-729`, replace `provider: "claude"` with `provider: state.snapshot.provider || "claude"`:

```typescript
case "SessionStart":
  if (event.session_id) {
    const provider = state.snapshot.provider || "claude";
    this.recordSessionAttached({
      terminalId,
      provider,
      sessionId: event.session_id as string,
      confidence: "strong",
      sessionFile: (event.transcript_path as string) ?? undefined,
    });
    if (event.transcript_path) {
      this.attachSessionSource({
        terminalId,
        provider,
        sessionId: event.session_id as string,
        confidence: "strong",
        sessionFile: event.transcript_path as string,
      });
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/telemetry-service.test.ts --test-name-pattern "registered provider"`
Expected: PASS

**Step 5: Run full telemetry test suite**

Run: `npx tsx --test tests/telemetry-service.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add electron/telemetry-service.ts tests/telemetry-service.test.ts
git commit -m "fix: use registered provider in recordHookEvent instead of hardcoded claude"
```

---

### Task 5: Type check and full test run

**Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all related tests**

Run: `npx tsx --test tests/skill-manager.test.ts tests/telemetry-service.test.ts tests/session-watcher.test.ts tests/session-panel-model.test.ts tests/terminal-telemetry-panel.test.ts`
Expected: All pass

**Step 3: Commit plan doc**

```bash
git add docs/plans/
git commit -m "docs: add Codex hook injection implementation plan"
```
