# CLI Detection: Current Implementation & Alternative Mechanisms

## 1. Current Implementation

### Detection Flow

1. Every terminal output (`onData`) triggers a debounced 3-second timer (`terminalRuntimeStore.ts:753`).
2. Timer fires → IPC call to main process → `detectCli(shellPid)` (`process-detector.ts:299`).
3. `detectCli` spawns a child process:
   - macOS/Linux: `ps -eo pid,ppid,args` (returns **all** system processes)
   - Windows: `Get-CimInstance Win32_Process | ConvertTo-Json` (returns **all** system processes)
4. Output is parsed into `ProcessEntry[]`, then BFS-traversed from `shellPid` to find descendant processes.
5. Each descendant's full `args` string is matched against `CLI_PATTERNS` regexes (`\bclaude\b`, `\bcodex\b`, etc.).
6. First (shallowest) match is returned. Terminal type switches once, then detection stops (`type !== "shell"` guard).

### What It Uses

| Component | Detail |
|-----------|--------|
| System command | `ps -eo pid,ppid,args` / PowerShell `Get-CimInstance` |
| Scope | All processes on the system |
| Matching input | Full command-line args string |
| Traversal | BFS from shell PID across entire process tree |
| Trigger | Terminal output + 3s debounce |

### What It Produces

- `DetectedCli`: `{ pid, cliType, args }`
- `ProcessSnapshot`: full descendant tree with `foregroundTool` (used by telemetry)

---

## 2. `tcgetpgrp` Mechanism (used by macOS Terminal.app)

### How Terminal.app Works

Terminal.app binary contains references to `_tcgetpgrp`, `_proc_pidinfo`, `_dispatch_source_create` (with `__dispatch_source_type_proc`). The mechanism:

1. `tcgetpgrp(master_fd)` — single syscall, returns the PID of the foreground process group leader of the PTY.
2. `proc_pidinfo(pid)` or `sysctl(KERN_PROC_PID)` — single syscall, returns process metadata for that PID.
3. `dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, pid, DISPATCH_PROC_EXEC | DISPATCH_PROC_EXIT | DISPATCH_PROC_FORK, queue)` — event-driven process state monitoring via GCD; no polling required.

### node-pty Already Exposes This

node-pty's `pty.process` getter calls `tcgetpgrp(fd)` internally on both macOS and Linux:

**macOS** (`pty.cc:656-675`):
```c
static char * pty_getproc(int fd) {
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, 0 };
  if ((mib[3] = tcgetpgrp(fd)) == -1) return NULL;
  // sysctl → returns kp_proc.p_comm (max 16 bytes, MAXCOMLEN)
  return strdup(kp.kp_proc.p_comm);
}
```

**Linux** (`pty.cc:614-651`):
```c
static char * pty_getproc(int fd, char *tty) {
  if ((pgrp = tcgetpgrp(fd)) == -1) return NULL;
  // reads /proc/<pgrp>/cmdline until first \0 → returns argv[0] only
  f = fopen("/proc/<pgrp>/cmdline", "r");
  while ((ch = fgetc(f)) != EOF) {
    if (ch == '\0') break;
    buf[len++] = ch;
  }
  return buf;
}
```

**Windows** (`windowsTerminal.js:182`):
```js
get process() { return this._name; }
// _name = opt.name || env.TERM || DEFAULT_NAME
// Static value set at spawn time. Does NOT track foreground process.
```

### `pty.process` Return Values (observed on macOS)

| CLI | Launch command | `pty.process` returns | Can identify? |
|-----|---------------|----------------------|---------------|
| claude | `claude` (native binary) | `"claude"` | Yes |
| opencode | `opencode` (native binary) | `"opencode"` | Yes |
| codex | `node ~/.nvm/.../bin/codex` | `"node"` | No |
| gemini | `npx @google/gemini-cli` | `"node"` | No |
| kimi | (if node-based) | `"node"` | No |
| any bun-launched CLI | `bun run ...` | `"bun"` | No |

Root cause: macOS `p_comm` is capped at 16 bytes (`MAXCOMLEN`) and contains the executable name only, not arguments.

Linux returns `argv[0]` from `/proc/<pgrp>/cmdline` (reads until first `\0`). For `node /path/to/codex`, `argv[0]` = `"node"` or `"/usr/bin/node"`. Same limitation.

### Windows: `GetConsoleProcessList`

node-pty on Windows has `conpty_console_list.cc` which exposes `getConsoleProcessList(shellPid)`:

```c
FreeConsole();
AttachConsole(pid);
GetConsoleProcessList(&processList, size);
```

This returns an array of PIDs attached to the console session of `shellPid`. It does not return process names or command lines — only PIDs. A separate call (e.g., `OpenProcess` + `QueryFullProcessImageNameW`, or WMI) is needed to resolve PIDs to names/args.

This API is scoped to a specific console session (not system-wide).

---

## 3. Side-by-Side: Factual Comparison

| Property | Current (`ps` scan) | `pty.process` (as-is) |
|----------|--------------------|-----------------------|
| **Syscall overhead** | Spawns child process (`execFile`) | Single `tcgetpgrp` + `sysctl`/`/proc` read |
| **Scope** | All system processes | One PID (foreground process group leader) |
| **Returns** | Full `args` for every process | Executable name only (`p_comm` / `argv[0]`) |
| **Can distinguish node-based CLIs** | Yes (matches full args) | No (`"node"` for all) |
| **macOS** | Supported | Supported |
| **Linux** | Supported | Supported |
| **Windows** | Supported (PowerShell) | Static value (does not track foreground) |
| **Provides process tree** | Yes (full descendant tree) | No (single PID) |
| **Used by `getProcessSnapshot`** | Yes (telemetry) | No |

---

## 4. Hybrid Possibility: `tcgetpgrp` + Targeted `ps`

A middle path exists but has not been implemented or tested:

1. Call `tcgetpgrp(fd)` via `pty.process` getter to obtain the foreground PID (microseconds).
2. If the returned name is a known wrapper (`"node"`, `"bun"`, `"npx"`, `"bunx"`), run a targeted `ps -o args= -p <pid>` on that single PID to get the full command line.
3. Match the full command line against `CLI_PATTERNS`.

This would avoid scanning all system processes while still obtaining full args for wrapper-launched CLIs.

**What this does NOT cover:**
- `getProcessSnapshot()` (telemetry) still needs the full process tree.
- Windows `pty.process` is static and returns the spawn-time name. Detection on Windows would need a different path — potentially `GetConsoleProcessList` (returns PIDs) + `QueryFullProcessImageNameW` (resolves PID to exe path), or the existing PowerShell approach.

---

## 5. `dispatch_source` (macOS Event-Driven Monitoring)

Terminal.app uses `dispatch_source_create` with `DISPATCH_SOURCE_TYPE_PROC` to receive events (fork/exec/exit) without polling. This is a macOS-only C API available through GCD (Grand Central Dispatch).

- Requires a known PID to watch.
- Fires on `DISPATCH_PROC_FORK`, `DISPATCH_PROC_EXEC`, `DISPATCH_PROC_EXIT`, `DISPATCH_PROC_SIGNAL`.
- Not available on Linux or Windows.
- Not exposed by node-pty or any standard Node.js API. Would require a native addon.

---

## 6. Reference: `pty.process` Accessor Path

```
pty.process (JS getter)
  ├── macOS: pty.process(this._fd)
  │     → pty_getproc(fd)
  │       → tcgetpgrp(fd) → foreground PGID
  │       → sysctl(KERN_PROC_PID, pgid) → kp_proc.p_comm (16 bytes max)
  │
  ├── Linux: pty.process(this._fd, this._pty)
  │     → pty_getproc(fd, tty)
  │       → tcgetpgrp(fd) → foreground PGID
  │       → fopen("/proc/<pgid>/cmdline") → argv[0] (until first \0)
  │
  └── Windows: this._name
        → static, set at spawn time (opt.name || env.TERM || "Windows Shell")
        → does NOT call tcgetpgrp (not available on Windows)
```
