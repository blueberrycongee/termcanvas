import { create } from "zustand";
import * as xtermModule from "@xterm/xterm";
import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SerializeAddon } from "@xterm/addon-serialize";
import { GhosttyWasmBackend } from "./backend/GhosttyWasmBackend";
import type {
  CompatibleTerminal,
  TerminalBackendKind,
} from "./backend/TerminalBackend";
import {
  acquireWebGL,
  releaseWebGL,
  touch as touchWebGL,
} from "./webglContextPool";
import {
  registerTerminal,
  serializeTerminal,
  unregisterTerminal,
} from "./terminalRegistry";
import { useNotificationStore } from "../stores/notificationStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useProjectStore } from "../stores/projectStore";
import { getTerminalDisplayTitle } from "../stores/terminalState";
import {
  resolveTerminalWithRuntimeState,
  useTerminalRuntimeStateStore,
} from "../stores/terminalRuntimeStateStore";
import { useQuotaStore } from "../stores/quotaStore";
import { useCodexQuotaStore } from "../stores/codexQuotaStore";
import { useThemeStore, XTERM_THEMES } from "../stores/themeStore";
import type { TerminalData, TerminalStatus, TerminalType } from "../types";
import { getTerminalLaunchOptions, getTerminalPromptArgs } from "./cliConfig";
import { buildFontFamily } from "./fontRegistry";
import { useLocaleStore } from "../stores/localeStore";
import { isRegisteredAppShortcutEvent } from "../stores/shortcutStore";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import type { TerminalTelemetrySnapshot } from "../../shared/telemetry";
import {
  CLI_DETECTION_MAX_ATTEMPTS,
  CLI_DETECTION_POLL_INTERVAL_MS,
  HOOK_SESSION_FALLBACK_MS,
  SESSION_POLL_INTERVAL_MS,
  SESSION_POLL_MAX_ATTEMPTS,
  SHELL_WAITING_AFTER_SILENCE_MS,
  TELEMETRY_POLL_FAST_MS,
  TELEMETRY_POLL_SLOW_MS,
  TELEMETRY_PUSH_STALE_MS,
  TURN_COMPLETE_DEDUP_MS,
  WORKTREE_ACTIVITY_THROTTLE_MS,
} from "../../shared/lifecycleThresholds";
import { onTerminalTurnCompleted } from "./summaryScheduler";
import {
  clampPreviewAnsi,
  resolveTerminalMountMode,
  TerminalMountMode,
  toPreviewText,
} from "./terminalRuntimePolicy";
import {
  createTerminalSelectionAutoCopyState,
  markTerminalSelectionChanged,
  markTerminalSelectionCopied,
  markTerminalSelectionPointerEnded,
  markTerminalSelectionPointerStarted,
  shouldAutoCopyTerminalSelection,
  type TerminalSelectionAutoCopyState,
} from "./selectionAutoCopy";

interface TerminalRuntimeMeta {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
}

interface TerminalRuntimeSnapshot {
  copiedNonce: number;
  mode: TerminalMountMode;
  previewText: string;
  telemetry: TerminalTelemetrySnapshot | null;
}

interface TerminalRuntimeStoreState {
  terminals: Record<string, TerminalRuntimeSnapshot>;
}

interface AttachOptions {
  onCopy?: () => void;
}

interface ManagedTerminalRuntime {
  activityPending: boolean;
  activityTimer: ReturnType<typeof setTimeout> | null;
  activityThrottled: boolean;
  attachedContainer: HTMLDivElement | null;
  attachOptions: AttachOptions | null;
  /**
   * Which backend this terminal is using. Frozen per-terminal once the
   * renderer is built — preference changes only affect newly-created tiles,
   * not live ones. `null` means the renderer hasn't been constructed yet.
   */
  backendKind: TerminalBackendKind | null;
  cliOverride: ReturnType<
    typeof usePreferencesStore.getState
  >["cliCommands"][TerminalType];
  currentStatus: TerminalStatus;
  detectAttempts: number;
  detectTimer: ReturnType<typeof setTimeout> | null;
  disposed: boolean;
  fitAddon: FitAddon | null;
  /**
   * Populated only when `backendKind === "ghostty-wasm"`. Holds the backend
   * wrapper so we can call backend-specific operations (fit, dispose) that
   * don't fit cleanly behind the CompatibleTerminal surface.
   */
  ghosttyBackend: GhosttyWasmBackend | null;
  globalDisposers: Array<() => void>;
  hasRespawned: boolean;
  hostElement: HTMLDivElement | null;
  inputDisposable: { dispose(): void } | null;
  meta: TerminalRuntimeMeta;
  mode: TerminalMountMode;
  outputUnsubscribe: (() => void) | null;
  ptyId: number | null;
  ptyPromise: Promise<void> | null;
  previewAnsi: string;
  /**
   * Resolves once the renderer for this runtime is actually ready to
   * receive writes. For xterm this resolves immediately (renderer is
   * synchronous); for ghostty-wasm it resolves after WASM init finishes.
   * Code paths that need a guaranteed-live `runtime.xterm` should await
   * this before touching it.
   */
  rendererPromise: Promise<void> | null;
  hookFallbackTimer: ReturnType<typeof setTimeout> | null;
  lastPushAt: number;
  lastTurnCompletedAt: number;
  removeHookSessionStarted: (() => void) | null;
  removeHookTurnComplete: (() => void) | null;
  removeHookStopFailure: (() => void) | null;
  removeTurnComplete: (() => void) | null;
  resizeDisposable: { dispose(): void } | null;
  selectionAutoCopy: TerminalSelectionAutoCopyState;
  selectionDisposable: { dispose(): void } | null;
  selectionPointerCleanup: (() => void) | null;
  serializeAddon: SerializeAddon | null;
  sessionCancel: (() => void) | null;
  started: boolean;
  telemetryTimer: ReturnType<typeof setInterval> | null;
  usesAgentRenderer: boolean;
  waitingTimer: ReturnType<typeof setTimeout> | null;
  wasResumeAttempt: boolean;
  watchedSessionId: string | null;
  /**
   * The active terminal handle. Typed as CompatibleTerminal so both xterm
   * and Ghostty-backed terminals can live behind this slot — the full
   * xterm.js Terminal is still assignable here because CompatibleTerminal
   * is a structural subset of it, but downstream code must limit itself to
   * the shared surface if it wants to work under both backends.
   */
  xterm: CompatibleTerminal | null;
}

type XtermTerminalConstructor = new (
  options?: ConstructorParameters<typeof xtermModule.Terminal>[0],
) => XtermTerminal;
type XtermRuntimeModule = typeof xtermModule & {
  default?: { Terminal?: XtermTerminalConstructor };
};

const dictionaries = { en, zh } as const;
const SPAWN_STAGGER_MS = 150;
const TERMINAL_PARKING_ROOT_ID = "tc-terminal-runtime-parking-root";

let spawnStaggerCount = 0;
let spawnStaggerResetTimer: ReturnType<typeof setTimeout> | null = null;

function nextSpawnDelay(): number {
  spawnStaggerCount += 1;
  if (spawnStaggerResetTimer) clearTimeout(spawnStaggerResetTimer);
  spawnStaggerResetTimer = setTimeout(() => {
    spawnStaggerCount = 0;
  }, 3_000);
  return spawnStaggerCount * SPAWN_STAGGER_MS;
}
const runtimeRegistry = new Map<string, ManagedTerminalRuntime>();
const xtermRuntimeModule = xtermModule as XtermRuntimeModule;
const XtermTerminalConstructor = (xtermRuntimeModule.Terminal ??
  xtermRuntimeModule.default?.Terminal) as XtermTerminalConstructor;

function isSessionTelemetryProvider(
  type: TerminalType,
): type is "claude" | "codex" | "wuu" {
  return type === "claude" || type === "codex" || type === "wuu";
}

export const useTerminalRuntimeStore = create<TerminalRuntimeStoreState>(
  () => ({
    terminals: {},
  }),
);

function getT() {
  const locale = useLocaleStore.getState().locale;
  return { ...en, ...dictionaries[locale] };
}

function updateRuntimeSnapshot(
  terminalId: string,
  patch: Partial<TerminalRuntimeSnapshot>,
) {
  useTerminalRuntimeStore.setState((state) => {
    const current = state.terminals[terminalId] ?? {
      copiedNonce: 0,
      mode: "parked" as TerminalMountMode,
      previewText: "",
      telemetry: null,
    };
    const next = { ...current, ...patch };

    if (
      next.copiedNonce === current.copiedNonce &&
      next.mode === current.mode &&
      next.previewText === current.previewText &&
      sameTelemetrySnapshot(next.telemetry, current.telemetry)
    ) {
      return state;
    }

    return {
      terminals: {
        ...state.terminals,
        [terminalId]: next,
      },
    };
  });
}

function sameTelemetrySnapshot(
  left: TerminalTelemetrySnapshot | null,
  right: TerminalTelemetrySnapshot | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.derived_status === right.derived_status &&
    left.provider === right.provider &&
    left.session_attached === right.session_attached &&
    left.last_meaningful_progress_at === right.last_meaningful_progress_at &&
    left.last_session_event_at === right.last_session_event_at &&
    left.last_session_event_kind === right.last_session_event_kind &&
    left.foreground_tool === right.foreground_tool &&
    left.active_tool_calls === right.active_tool_calls &&
    left.last_tool_event_at === right.last_tool_event_at &&
    left.task_status === right.task_status &&
    left.task_status_source === right.task_status_source &&
    left.result_exists === right.result_exists &&
    left.turn_state === right.turn_state
  );
}

function removeRuntimeSnapshot(terminalId: string) {
  useTerminalRuntimeStore.setState((state) => {
    if (!(terminalId in state.terminals)) {
      return state;
    }

    const next = { ...state.terminals };
    delete next[terminalId];
    return { terminals: next };
  });
}

function pushPreview(runtime: ManagedTerminalRuntime, serialized: string) {
  const nextAnsi = clampPreviewAnsi(serialized);
  if (nextAnsi === runtime.previewAnsi) {
    return;
  }

  runtime.previewAnsi = nextAnsi;
  updateRuntimeSnapshot(runtime.meta.terminal.id, {
    previewText: toPreviewText(nextAnsi),
  });
}

function appendPreview(runtime: ManagedTerminalRuntime, chunk: string) {
  pushPreview(runtime, runtime.previewAnsi + chunk);
}

function bumpCopiedNonce(terminalId: string) {
  useTerminalRuntimeStore.setState((state) => {
    const current = state.terminals[terminalId] ?? {
      copiedNonce: 0,
      mode: "parked" as TerminalMountMode,
      previewText: "",
      telemetry: null,
    };

    return {
      terminals: {
        ...state.terminals,
        [terminalId]: {
          ...current,
          copiedNonce: current.copiedNonce + 1,
        },
      },
    };
  });
}

function dispatchWorktreeActivity(worktreePath: string) {
  window.dispatchEvent(
    new CustomEvent("termcanvas:worktree-activity", {
      detail: worktreePath,
    }),
  );
}

async function pollSessionId(
  ptyId: number,
  cliType: string,
  worktreePath: string,
  onFound: (match: {
    sessionId: string;
    confidence?: "strong" | "medium" | "weak";
  }) => void,
  shouldCancel: () => boolean,
  detectedCliPid?: number | null,
  startedAt?: string,
) {
  const maxAttempts =
    cliType === "codex"
      ? SESSION_POLL_MAX_ATTEMPTS.codex
      : cliType === "wuu"
        ? SESSION_POLL_MAX_ATTEMPTS.wuu
        : SESSION_POLL_MAX_ATTEMPTS.default;
  const interval =
    cliType === "codex"
      ? SESSION_POLL_INTERVAL_MS.codex
      : cliType === "wuu"
        ? SESSION_POLL_INTERVAL_MS.wuu
        : SESSION_POLL_INTERVAL_MS.default;

  let cachedPid: number | null = detectedCliPid ?? null;
  if (!cachedPid && cliType === "claude") {
    cachedPid = (await window.termcanvas.terminal.getPid(ptyId)) ?? null;
  }

  let codexBaseline: string | null = null;
  if (cliType === "codex") {
    codexBaseline = await window.termcanvas.session.getCodexLatest();
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Always wait before polling — Codex needs time to write its session
    // file after launch.  Polling immediately on the first attempt would
    // find the PREVIOUS session in the same cwd and lock onto it because
    // onFound returns after the first match.
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (shouldCancel()) {
      return;
    }

    let sessionId: string | null = null;
    let confidence: "strong" | "medium" | "weak" | undefined;
    if (cliType === "codex") {
      const candidate = await window.termcanvas.session.findCodex(
        worktreePath,
        startedAt,
      );
      sessionId = candidate?.sessionId ?? null;
      confidence = candidate?.confidence;
      // Reject baseline (the session that existed before this terminal
      // started) so we don't attach to a stale session.
      if (sessionId && sessionId === codexBaseline) {
        sessionId = null;
        confidence = undefined;
      }
    } else if (cliType === "claude") {
      const pid =
        cachedPid ?? (await window.termcanvas.terminal.getPid(ptyId)) ?? null;
      if (!cachedPid && pid) {
        cachedPid = pid;
      }
      const candidate = await window.termcanvas.session.findClaude(
        worktreePath,
        startedAt,
        pid,
      );
      sessionId = candidate?.sessionId ?? null;
      confidence = candidate?.confidence;
    } else if (cliType === "kimi") {
      sessionId = await window.termcanvas.session.getKimiLatest(worktreePath);
    } else if (cliType === "wuu") {
      const candidate = await window.termcanvas.session.findWuu(
        worktreePath,
        startedAt,
      );
      sessionId = candidate?.sessionId ?? null;
      confidence = candidate?.confidence;
    }

    if (shouldCancel()) {
      return;
    }

    if (sessionId) {
      onFound({ sessionId, confidence });
      return;
    }
  }

  return "timeout";
}

function notify(type: "error" | "info" | "warn", message: string) {
  useNotificationStore.getState().notify(type, message);
}

function updateTerminalInStore(
  runtime: ManagedTerminalRuntime,
  updater: (terminal: TerminalData) => TerminalData,
) {
  runtime.meta = {
    ...runtime.meta,
    terminal: updater(runtime.meta.terminal),
  };
}

function withResolvedRuntimeMeta(
  meta: TerminalRuntimeMeta,
): TerminalRuntimeMeta {
  return {
    ...meta,
    terminal: resolveTerminalWithRuntimeState(meta.terminal),
  };
}

function setPtyId(runtime: ManagedTerminalRuntime, ptyId: number | null) {
  runtime.ptyId = ptyId;
  useTerminalRuntimeStateStore
    .getState()
    .setPtyId(runtime.meta.terminal.id, ptyId);
  updateTerminalInStore(runtime, (terminal) => ({ ...terminal, ptyId }));
}

function setStatus(runtime: ManagedTerminalRuntime, status: TerminalStatus) {
  if (runtime.currentStatus === status) {
    return;
  }

  runtime.currentStatus = status;
  useTerminalRuntimeStateStore
    .getState()
    .setStatus(runtime.meta.terminal.id, status);
  updateTerminalInStore(runtime, (terminal) => ({ ...terminal, status }));
}

function setSessionId(
  runtime: ManagedTerminalRuntime,
  sessionId: string | undefined,
) {
  const prev = runtime.meta.terminal.sessionId;
  const store = useProjectStore.getState();

  useTerminalRuntimeStateStore
    .getState()
    .setSessionId(runtime.meta.terminal.id, sessionId);

  if (prev && prev !== sessionId && runtime.meta.terminal.customTitle) {
    store.updateTerminalCustomTitle(
      runtime.meta.projectId,
      runtime.meta.worktreeId,
      runtime.meta.terminal.id,
      "",
    );
    updateTerminalInStore(runtime, (terminal) => ({
      ...terminal,
      sessionId,
      customTitle: undefined,
    }));
  } else {
    updateTerminalInStore(runtime, (terminal) => ({ ...terminal, sessionId }));
  }
}

function setAutoApprove(runtime: ManagedTerminalRuntime, autoApprove: boolean) {
  useProjectStore
    .getState()
    .updateTerminalAutoApprove(
      runtime.meta.projectId,
      runtime.meta.worktreeId,
      runtime.meta.terminal.id,
      autoApprove,
    );
  updateTerminalInStore(runtime, (terminal) => ({
    ...terminal,
    autoApprove: autoApprove || undefined,
  }));
}

async function syncPermissionMode(
  runtime: ManagedTerminalRuntime,
  sessionId: string,
) {
  try {
    const type = runtime.meta.terminal.type;
    let shouldBypass = false;

    if (type === "claude" || type === "codex") {
      shouldBypass = await window.termcanvas.session.getBypassState(
        type,
        sessionId,
        runtime.meta.worktreePath,
      );
    }

    if (runtime.disposed) return;
    if (shouldBypass !== !!runtime.meta.terminal.autoApprove) {
      setAutoApprove(runtime, shouldBypass);
    }
  } catch (error) {
    console.error("[terminalRuntime] failed to sync permission mode:", error);
  }
}

function clearWatchedSession(runtime: ManagedTerminalRuntime) {
  if (!runtime.watchedSessionId) {
    return;
  }

  const sessionId = runtime.watchedSessionId;
  runtime.watchedSessionId = null;
  if (isSessionTelemetryProvider(runtime.meta.terminal.type)) {
    void window.termcanvas.telemetry
      .detachSession(runtime.meta.terminal.id)
      .catch((error) => {
        console.error(
          "[terminalRuntime] failed to detach telemetry session:",
          error,
        );
      });
  }
  void window.termcanvas.session.unwatch(sessionId).catch((error) => {
    console.error("[terminalRuntime] failed to unwatch session:", error);
  });
}

function watchSession(
  runtime: ManagedTerminalRuntime,
  type: TerminalType,
  sessionId: string,
  confidence?: "strong" | "medium" | "weak",
) {
  if (runtime.disposed) {
    return;
  }

  if (runtime.watchedSessionId && runtime.watchedSessionId !== sessionId) {
    clearWatchedSession(runtime);
  }

  runtime.watchedSessionId = sessionId;
  if (isSessionTelemetryProvider(type)) {
    void window.termcanvas.telemetry
      .attachSession({
        terminalId: runtime.meta.terminal.id,
        provider: type,
        sessionId,
        cwd: runtime.meta.worktreePath,
        confidence: confidence ?? (type === "claude" ? "strong" : "medium"),
      })
      .catch((error: unknown) => {
        console.error("[terminalRuntime] telemetry attach failed:", error);
      });
  }
  void window.termcanvas.session
    .watch(type, sessionId, runtime.meta.worktreePath)
    .then((result) => {
      if (runtime.disposed || runtime.watchedSessionId !== sessionId) {
        return;
      }

      if (!result?.ok) {
        notify("warn", `Session watch failed: ${result?.reason ?? "unknown"}`);
      }
    })
    .catch((error: unknown) => {
      if (runtime.disposed || runtime.watchedSessionId !== sessionId) {
        return;
      }

      console.error("[terminalRuntime] session watch failed:", error);
    });
}

function setTerminalType(runtime: ManagedTerminalRuntime, type: TerminalType) {
  useProjectStore
    .getState()
    .updateTerminalType(
      runtime.meta.projectId,
      runtime.meta.worktreeId,
      runtime.meta.terminal.id,
      type,
    );
  updateTerminalInStore(runtime, (terminal) => ({ ...terminal, type }));
}

function lookupCurrentTerminal(runtime: ManagedTerminalRuntime) {
  const state = useProjectStore.getState();
  const project = state.projects.find(
    (entry) => entry.id === runtime.meta.projectId,
  );
  const worktree = project?.worktrees.find(
    (entry) => entry.id === runtime.meta.worktreeId,
  );
  const terminal = worktree?.terminals.find(
    (entry) => entry.id === runtime.meta.terminal.id,
  );
  return terminal
    ? resolveTerminalWithRuntimeState(terminal)
    : resolveTerminalWithRuntimeState(runtime.meta.terminal);
}

function disposeInteractiveBindings(runtime: ManagedTerminalRuntime) {
  runtime.inputDisposable?.dispose();
  runtime.inputDisposable = null;
  runtime.resizeDisposable?.dispose();
  runtime.resizeDisposable = null;
}

function disposeSelectionBindings(runtime: ManagedTerminalRuntime) {
  runtime.selectionDisposable?.dispose();
  runtime.selectionDisposable = null;
  runtime.selectionPointerCleanup?.();
  runtime.selectionPointerCleanup = null;
  runtime.selectionAutoCopy = createTerminalSelectionAutoCopyState();
}

function disposeRendererBindings(runtime: ManagedTerminalRuntime) {
  disposeInteractiveBindings(runtime);
  disposeSelectionBindings(runtime);
}

function shouldFitAttachedRuntime(runtime: ManagedTerminalRuntime) {
  return !!runtime.attachedContainer;
}

function ensureRuntimeWebGL(runtime: ManagedTerminalRuntime) {
  if (!runtime.xterm) {
    return false;
  }
  // WebGL pool is xterm-specific — it loads `@xterm/addon-webgl` against a
  // real xterm.js Terminal. Ghostty's Canvas renderer draws its own canvas
  // and has no addon surface for this path to attach to. Runtimes with an
  // un-set backendKind are treated as xterm-backed for backward
  // compatibility with existing tests that poke runtime.xterm directly.
  if (runtime.backendKind === "ghostty-wasm") {
    return false;
  }
  return acquireWebGL(runtime.meta.terminal.id, runtime.xterm as XtermTerminal);
}

function scheduleRuntimeRefresh(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }

  setTimeout(callback, 0);
}

function ensureParkingRoot(): HTMLDivElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  let root = document.getElementById(
    TERMINAL_PARKING_ROOT_ID,
  ) as HTMLDivElement | null;
  if (root) {
    return root;
  }

  root = document.createElement("div");
  root.id = TERMINAL_PARKING_ROOT_ID;
  root.setAttribute("aria-hidden", "true");
  root.style.position = "fixed";
  root.style.left = "-10000px";
  root.style.top = "0";
  root.style.width = "1px";
  root.style.height = "1px";
  root.style.opacity = "0";
  root.style.pointerEvents = "none";
  root.style.overflow = "hidden";

  document.body?.appendChild(root);
  return root.parentElement ? root : null;
}

function ensureRuntimeHost(
  runtime: ManagedTerminalRuntime,
): HTMLDivElement | null {
  if (runtime.hostElement || typeof document === "undefined") {
    return runtime.hostElement;
  }

  const host = document.createElement("div");
  host.className = "tc-xterm-host nopan nodrag nowheel";
  host.style.position = "absolute";
  host.style.inset = "0";
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.overflow = "hidden";
  runtime.hostElement = host;
  return host;
}

function attachTerminalHost(
  runtime: ManagedTerminalRuntime,
  container: HTMLDivElement,
): HTMLDivElement | null {
  const host = ensureRuntimeHost(runtime);
  if (!host) {
    return null;
  }

  if (host.parentElement !== container) {
    container.appendChild(host);
  }
  runtime.attachedContainer = container;
  return host;
}

function parkTerminalHost(runtime: ManagedTerminalRuntime) {
  runtime.attachedContainer = null;

  const host = runtime.hostElement;
  if (!host) {
    return;
  }

  const parkingRoot = ensureParkingRoot();
  if (parkingRoot) {
    if (host.parentElement !== parkingRoot) {
      parkingRoot.appendChild(host);
    }
    return;
  }

  host.parentElement?.removeChild(host);
}

function removeTerminalHost(runtime: ManagedTerminalRuntime) {
  runtime.attachedContainer = null;

  const host = runtime.hostElement;
  if (!host) {
    return;
  }

  host.parentElement?.removeChild(host);
  runtime.hostElement = null;
}

function wireSelectionBindings(
  runtime: ManagedTerminalRuntime,
  host: HTMLDivElement,
) {
  const xterm = runtime.xterm;
  if (!xterm) {
    return;
  }

  disposeSelectionBindings(runtime);

  const maybeAutoCopySelection = () => {
    const text = xterm.getSelection();
    if (
      !shouldAutoCopyTerminalSelection(
        runtime.selectionAutoCopy,
        text,
        "mouseup",
      )
    ) {
      return;
    }

    runtime.selectionAutoCopy = markTerminalSelectionCopied(
      runtime.selectionAutoCopy,
    );
    void navigator.clipboard.writeText(text).catch(() => {});
    bumpCopiedNonce(runtime.meta.terminal.id);
    runtime.attachOptions?.onCopy?.();
  };

  const handleSelectionMouseUp = () => {
    maybeAutoCopySelection();
    runtime.selectionAutoCopy = markTerminalSelectionPointerEnded(
      runtime.selectionAutoCopy,
    );
  };
  const handleSelectionMouseDown = () => {
    runtime.selectionAutoCopy = markTerminalSelectionPointerStarted(
      runtime.selectionAutoCopy,
    );
  };
  host.addEventListener("mousedown", handleSelectionMouseDown);
  window.addEventListener("mouseup", handleSelectionMouseUp);
  runtime.selectionPointerCleanup = () => {
    host.removeEventListener("mousedown", handleSelectionMouseDown);
    window.removeEventListener("mouseup", handleSelectionMouseUp);
  };

  runtime.selectionDisposable = xterm.onSelectionChange(() => {
    runtime.selectionAutoCopy = markTerminalSelectionChanged(
      runtime.selectionAutoCopy,
    );
  });
}

function wireRendererBindings(
  runtime: ManagedTerminalRuntime,
  host: HTMLDivElement,
) {
  wireSelectionBindings(runtime, host);
  wireInteractiveBindings(runtime);
}

function serializeRuntimeBuffer(
  runtime: ManagedTerminalRuntime,
): string | null {
  if (runtime.serializeAddon) {
    return runtime.serializeAddon.serialize();
  }
  if (runtime.ghosttyBackend) {
    return runtime.ghosttyBackend.serialize();
  }
  return null;
}

function detachTerminalRenderer(runtime: ManagedTerminalRuntime) {
  if (!runtime.xterm) {
    removeTerminalHost(runtime);
    return;
  }

  const serialized = serializeRuntimeBuffer(runtime);
  if (serialized) {
    pushPreview(runtime, serialized);
  }

  disposeRendererBindings(runtime);
  unregisterTerminal(runtime.meta.terminal.id);
  releaseWebGL(runtime.meta.terminal.id);
  runtime.xterm.dispose();
  runtime.xterm = null;
  runtime.fitAddon = null;
  runtime.serializeAddon = null;
  runtime.ghosttyBackend = null;
  runtime.backendKind = null;
  runtime.rendererPromise = null;
  removeTerminalHost(runtime);
}

function parkTerminalRenderer(runtime: ManagedTerminalRuntime) {
  if (!runtime.xterm) {
    parkTerminalHost(runtime);
    return;
  }

  runtime.xterm.blur();
  const serialized = serializeRuntimeBuffer(runtime);
  if (serialized) {
    pushPreview(runtime, serialized);
  }

  disposeRendererBindings(runtime);
  parkTerminalHost(runtime);
}

function wireInteractiveBindings(runtime: ManagedTerminalRuntime) {
  if (!runtime.xterm || runtime.ptyId === null || !runtime.attachedContainer) {
    return;
  }

  runtime.inputDisposable?.dispose();
  runtime.resizeDisposable?.dispose();

  runtime.inputDisposable = runtime.xterm.onData((data: string) => {
    if (runtime.ptyId !== null) {
      window.termcanvas.terminal.input(runtime.ptyId, data);
    }
  });

  runtime.resizeDisposable = runtime.xterm.onResize(
    ({ cols, rows }: { cols: number; rows: number }) => {
      if (runtime.ptyId !== null) {
        window.termcanvas.terminal.resize(runtime.ptyId, cols, rows);
      }
    },
  );
}

function syncAttachedTerminalGeometry(runtime: ManagedTerminalRuntime) {
  if (
    !runtime.xterm ||
    runtime.ptyId === null ||
    !shouldFitAttachedRuntime(runtime)
  ) {
    return;
  }

  if (runtime.backendKind === "ghostty-wasm" && runtime.ghosttyBackend) {
    runtime.ghosttyBackend.fit();
  } else if (runtime.fitAddon) {
    runtime.fitAddon.fit();
  } else {
    return;
  }

  window.termcanvas.terminal.resize(
    runtime.ptyId,
    runtime.xterm.cols,
    runtime.xterm.rows,
  );
}

function createTerminalRenderer(
  runtime: ManagedTerminalRuntime,
  container: HTMLDivElement,
) {
  const preferences = usePreferencesStore.getState();
  if (preferences.terminalBackend === "ghostty-wasm") {
    createGhosttyRenderer(runtime, container);
    return;
  }
  createXtermRenderer(runtime, container);
}

function customKeyHandlerFor(runtime: ManagedTerminalRuntime) {
  return (event: KeyboardEvent): boolean => {
    if (event.type === "keydown" && isRegisteredAppShortcutEvent(event)) {
      return false;
    }

    if (event.type === "keydown" && event.metaKey) {
      if (event.key === "Backspace" && runtime.ptyId !== null) {
        window.termcanvas.terminal.input(runtime.ptyId, "\x15");
      }
      return false;
    }

    return true;
  };
}

function createXtermRenderer(
  runtime: ManagedTerminalRuntime,
  container: HTMLDivElement,
) {
  const theme = useThemeStore.getState().theme;
  const preferences = usePreferencesStore.getState();
  const xterm = new XtermTerminalConstructor({
    allowTransparency: false,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    fontFamily: buildFontFamily(preferences.terminalFontFamily),
    fontSize: preferences.terminalFontSize,
    lineHeight: 1.4,
    minimumContrastRatio: preferences.minimumContrastRatio,
    scrollback: 50_000,
    theme: XTERM_THEMES[theme],
  });
  const fitAddon = new FitAddon();
  const serializeAddon = new SerializeAddon();
  const host = attachTerminalHost(runtime, container);
  if (!host) {
    return;
  }

  xterm.loadAddon(fitAddon);
  xterm.loadAddon(serializeAddon);
  xterm.open(host);

  try {
    xterm.loadAddon(new ImageAddon());
  } catch {}

  xterm.attachCustomKeyEventHandler(customKeyHandlerFor(runtime));

  runtime.xterm = xterm;
  runtime.fitAddon = fitAddon;
  runtime.serializeAddon = serializeAddon;
  runtime.backendKind = "xterm";
  runtime.rendererPromise = Promise.resolve();
  ensureRuntimeWebGL(runtime);

  registerTerminal(runtime.meta.terminal.id, xterm, serializeAddon);
  if (runtime.previewAnsi) {
    xterm.write(runtime.previewAnsi, () => {
      if (!runtime.disposed && runtime.xterm) {
        xterm.scrollToBottom();
      }
    });
  }

  wireRendererBindings(runtime, host);
  scheduleRuntimeRefresh(() => {
    syncAttachedTerminalGeometry(runtime);
    runtime.xterm?.refresh?.(0, (runtime.xterm?.rows ?? 1) - 1);
  });
}

function createGhosttyRenderer(
  runtime: ManagedTerminalRuntime,
  container: HTMLDivElement,
) {
  const theme = useThemeStore.getState().theme;
  const preferences = usePreferencesStore.getState();
  const host = attachTerminalHost(runtime, container);
  if (!host) {
    return;
  }

  runtime.backendKind = "ghostty-wasm";
  // Mark the renderer as "coming" so callers that explicitly await
  // readiness (fit, refresh, write) don't race the async init.
  runtime.rendererPromise = (async () => {
    try {
      const backend = await GhosttyWasmBackend.create({
        container: host,
        cursorBlink: true,
        fontFamily: buildFontFamily(preferences.terminalFontFamily),
        fontSize: preferences.terminalFontSize,
        minimumContrastRatio: preferences.minimumContrastRatio,
        scrollback: 50_000,
        theme: XTERM_THEMES[theme],
      });

      if (runtime.disposed) {
        backend.terminal.dispose();
        return;
      }

      backend.terminal.attachCustomKeyEventHandler(customKeyHandlerFor(runtime));
      runtime.ghosttyBackend = backend;
      runtime.xterm = backend.terminal;

      if (runtime.previewAnsi) {
        backend.terminal.write(runtime.previewAnsi, () => {
          if (!runtime.disposed) {
            backend.terminal.scrollToBottom();
          }
        });
      }

      wireRendererBindings(runtime, host);
      scheduleRuntimeRefresh(() => {
        syncAttachedTerminalGeometry(runtime);
      });
    } catch (error) {
      notify(
        "error",
        `Failed to initialise Ghostty terminal backend: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      runtime.rendererPromise = null;
      runtime.backendKind = null;
    }
  })();
}

function clearRuntimeTimers(runtime: ManagedTerminalRuntime) {
  if (runtime.activityTimer) {
    clearTimeout(runtime.activityTimer);
    runtime.activityTimer = null;
  }
  if (runtime.detectTimer) {
    clearTimeout(runtime.detectTimer);
    runtime.detectTimer = null;
  }
  if (runtime.waitingTimer) {
    clearTimeout(runtime.waitingTimer);
    runtime.waitingTimer = null;
  }
  if (runtime.telemetryTimer) {
    clearInterval(runtime.telemetryTimer);
    runtime.telemetryTimer = null;
  }
}

function refitActiveBackend(runtime: ManagedTerminalRuntime) {
  if (!shouldFitAttachedRuntime(runtime)) {
    return;
  }
  if (runtime.backendKind === "ghostty-wasm" && runtime.ghosttyBackend) {
    runtime.ghosttyBackend.fit();
    return;
  }
  runtime.fitAddon?.fit();
}

/**
 * Rebuild a Ghostty tile's backend against a new theme.
 *
 * Why a full rebuild instead of an in-place palette swap:
 * ghostty-web v0.4.0 (and the ghostty-vt WASM core under it) resolves
 * palette indexes to raw RGB at *write* time and stores the resolved
 * triple on the cell. Once a cell is written, its colour is frozen —
 * there's no cell-level API, and no WASM export, that can re-resolve
 * existing cells against a new palette. `renderer.setTheme` only swaps
 * `theme.background/selection/cursor` (which affect gaps and overlays)
 * plus the *renderer's* copy of the 16-slot palette; cells never read
 * from that copy, so shell / agent / TUI output rendered under the old
 * theme keeps its old-theme colours indefinitely. For Claude/Codex
 * full-screen UIs where every cell carries an explicit background, that
 * means the tile looks unchanged after a toggle.
 *
 * The only fix we can land in *this* repo is to tear the Terminal down
 * and rebuild it with the new theme applied at creation time. The PTY
 * stays alive (it's on `runtime`, not on the Terminal), so the agent
 * process is undisturbed. We issue a no-op PTY resize after attach to
 * poke SIGWINCH, which most TUIs use as a cue to repaint — so the tile
 * is back to filled content within a frame or two of the swap.
 *
 * Trade-offs baked in:
 *  - scrollback/viewport visible in the tile is lost (no way to re-ink
 *    it without the original palette index, which is the exact info
 *    ghostty's WASM threw away);
 *  - an overlay with the new theme's background masks the swap so the
 *    user sees a colour fade rather than a flash of empty DOM;
 *  - keyboard focus on the tile's textarea is restored after the new
 *    backend is live.
 *
 * This path only runs from the module-level theme subscription. Any
 * future fix to the recreate logic reaches every live tile on the next
 * toggle (the subscription reads the current module's function at call
 * time), so a dev tweak here doesn't require tearing tiles down by hand.
 */
async function recreateGhosttyBackendForTheme(
  runtime: ManagedTerminalRuntime,
  nextTheme: ITheme,
): Promise<void> {
  const oldBackend = runtime.ghosttyBackend;
  const container = runtime.attachedContainer;
  const host = runtime.hostElement;
  if (!oldBackend || !container || !host) return;

  const preferences = usePreferencesStore.getState();
  const hadFocus =
    host.contains(document.activeElement) ||
    document.activeElement === host;

  // Paint an overlay that already uses the new theme's background colour
  // so the intermediate "empty host" frame between dispose and open is
  // invisible to the user. position:absolute over the host; fades out
  // once the new backend has painted at least once.
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.backgroundColor = nextTheme.background ?? "#000000";
  overlay.style.zIndex = "9999";
  overlay.style.pointerEvents = "none";
  overlay.style.transition = "opacity 120ms ease-out";
  overlay.style.opacity = "1";
  // Host may not be positioned; the overlay needs it to be.
  const hostPositionBefore = host.style.position;
  if (!hostPositionBefore || hostPositionBefore === "static") {
    host.style.position = "relative";
  }
  host.appendChild(overlay);

  disposeRendererBindings(runtime);
  oldBackend.terminal.dispose();
  runtime.xterm = null;
  runtime.ghosttyBackend = null;
  // Overlay was appended to host; dispose removed canvas/textarea but kept
  // the host div itself. Keep backendKind set so the subscription knows
  // this is still a ghostty tile while the new backend is being built.
  runtime.rendererPromise = (async () => {
    try {
      const backend = await GhosttyWasmBackend.create({
        container: host,
        cursorBlink: true,
        fontFamily: buildFontFamily(preferences.terminalFontFamily),
        fontSize: preferences.terminalFontSize,
        minimumContrastRatio: preferences.minimumContrastRatio,
        scrollback: 50_000,
        theme: nextTheme,
      });

      if (runtime.disposed) {
        backend.terminal.dispose();
        return;
      }

      backend.terminal.attachCustomKeyEventHandler(
        customKeyHandlerFor(runtime),
      );
      runtime.ghosttyBackend = backend;
      runtime.xterm = backend.terminal;

      // Re-append overlay after `backend.terminal.open()` may have
      // `replaceChildren()`-wiped the host. If the overlay is gone we
      // re-create it so the fade-out completes uniformly; if it's still
      // there (ghostty didn't touch it), we reuse it.
      if (!host.contains(overlay)) {
        host.appendChild(overlay);
      }

      wireRendererBindings(runtime, host);
      scheduleRuntimeRefresh(() => {
        syncAttachedTerminalGeometry(runtime);
      });

      // Force SIGWINCH to the PTY so Claude / Codex / vim / tmux / shell
      // repaint the full frame with the new theme's colours. Toggling by
      // one row is cheap and universally interpreted as a genuine size
      // change by TUI apps.
      if (runtime.ptyId !== null) {
        const cols = backend.terminal.cols;
        const rows = backend.terminal.rows;
        window.termcanvas.terminal.resize(runtime.ptyId, cols, rows + 1);
        window.termcanvas.terminal.resize(runtime.ptyId, cols, rows);
      }

      if (hadFocus) {
        backend.terminal.focus();
      }
    } catch (error) {
      notify(
        "error",
        `Failed to re-theme Ghostty terminal backend: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      runtime.rendererPromise = null;
      runtime.backendKind = null;
    } finally {
      // Two rAFs to ensure at least one paint has landed behind the
      // overlay, then fade out. The fade masks any lingering gap
      // between "new backend mounted" and "SIGWINCH-driven repaint
      // arrived from the PTY".
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.style.opacity = "0";
          setTimeout(() => {
            overlay.remove();
            if (hostPositionBefore === "" || hostPositionBefore === "static") {
              host.style.position = hostPositionBefore;
            }
          }, 160);
        });
      });
    }
  })();
}

function applyThemeToRuntime(
  runtime: ManagedTerminalRuntime,
  theme: ITheme,
): void {
  if (runtime.disposed) return;

  if (runtime.backendKind === "ghostty-wasm" && runtime.ghosttyBackend) {
    void recreateGhosttyBackendForTheme(runtime, theme);
  } else if (runtime.xterm) {
    // xterm stores palette indexes + colour-mode tags on each cell, so a
    // theme swap + refresh re-paints live cells against the new palette
    // without any teardown.
    runtime.xterm.options.theme = theme;
    runtime.xterm.refresh?.(0, runtime.xterm.rows - 1);
  }

  if (runtime.ptyId !== null) {
    window.termcanvas.terminal.notifyThemeChanged(runtime.ptyId);
  }
}

// One global subscription fans the theme change out to every live runtime
// in the registry. Replacing the per-runtime subscription that used to live
// in `setupRuntimeSubscriptions` means that when this file ships a theme-
// related fix, every already-attached tile picks it up on the next toggle
// without needing to be torn down and recreated. The per-runtime closure
// would have frozen the old implementation at tile-creation time.
useThemeStore.subscribe((state) => {
  const theme = XTERM_THEMES[state.theme];
  for (const runtime of runtimeRegistry.values()) {
    applyThemeToRuntime(runtime, theme);
  }
});

function setupRuntimeSubscriptions(runtime: ManagedTerminalRuntime) {
  const preferencesUnsubscribe = usePreferencesStore.subscribe((state) => {
    if (!runtime.xterm) {
      return;
    }

    const family = buildFontFamily(state.terminalFontFamily);
    if (runtime.xterm.options.fontFamily !== family) {
      runtime.xterm.options.fontFamily = family;
      refitActiveBackend(runtime);
    }

    if (runtime.xterm.options.fontSize !== state.terminalFontSize) {
      runtime.xterm.options.fontSize = state.terminalFontSize;
      refitActiveBackend(runtime);
    }

    if (
      runtime.xterm.options.minimumContrastRatio !== state.minimumContrastRatio
    ) {
      runtime.xterm.options.minimumContrastRatio = state.minimumContrastRatio;
      runtime.xterm.refresh?.(0, runtime.xterm.rows - 1);
    }
  });

  // Theme updates are delivered by the module-level subscription above; no
  // per-runtime theme unsubscribe to track here.
  runtime.globalDisposers.push(preferencesUnsubscribe);
}

function refreshTelemetry(runtime: ManagedTerminalRuntime) {
  if (!window.termcanvas?.telemetry) {
    return;
  }

  void window.termcanvas.telemetry
    .getTerminal(runtime.meta.terminal.id)
    .then((snapshot) => {
      if (runtime.disposed) return;
      updateRuntimeSnapshot(runtime.meta.terminal.id, {
        telemetry: snapshot,
      });
    })
    .catch(() => {
      if (runtime.disposed) return;
      updateRuntimeSnapshot(runtime.meta.terminal.id, {
        telemetry: null,
      });
    });
}

function scheduleSessionCapture(
  runtime: ManagedTerminalRuntime,
  ptyId: number,
  cliType: TerminalType,
  detectedCliPid?: number | null,
) {
  runtime.sessionCancel?.();
  let cancelled = false;
  runtime.sessionCancel = () => {
    cancelled = true;
  };

  pollSessionId(
    ptyId,
    cliType,
    runtime.meta.worktreePath,
    ({ sessionId, confidence }) => {
      setSessionId(runtime, sessionId);
      if (isSessionTelemetryProvider(cliType)) {
        watchSession(runtime, cliType, sessionId, confidence);
      }
      if (cliType === "claude" || cliType === "codex") {
        void syncPermissionMode(runtime, sessionId);
      }
    },
    () => cancelled || runtime.disposed,
    detectedCliPid,
    new Date().toISOString(),
  ).then((result) => {
    if (result === "timeout") {
      notify(
        "warn",
        `Session capture timeout for ${getTerminalDisplayTitle(runtime.meta.terminal)}`,
      );
    }
  });
}

function triggerDetection(runtime: ManagedTerminalRuntime) {
  if (runtime.meta.terminal.type !== "shell" || runtime.ptyId === null) {
    return;
  }

  if (runtime.detectAttempts >= CLI_DETECTION_MAX_ATTEMPTS) return;

  // Don't reset an already-scheduled timer — allows detection during active output
  if (runtime.detectTimer) return;

  runtime.detectTimer = setTimeout(() => {
    runtime.detectTimer = null;

    if (runtime.ptyId === null || runtime.disposed) {
      return;
    }

    runtime.detectAttempts++;
    void window.termcanvas.terminal.detectCli(runtime.ptyId).then((result) => {
      const nextType = (result?.cliType ?? null) as TerminalType | null;
      if (!nextType || nextType === runtime.meta.terminal.type) {
        // Still undetected — reschedule
        triggerDetection(runtime);
        return;
      }

      setTerminalType(runtime, nextType);
      if (result?.autoApprove) {
        setAutoApprove(runtime, true);
      }
      if (nextType === "claude") {
        useQuotaStore.getState().nudge();
      } else if (nextType === "codex") {
        void useCodexQuotaStore.getState().fetch();
      }
      if (isSessionTelemetryProvider(nextType)) {
        void window.termcanvas.telemetry
          .updateTerminal({
            terminalId: runtime.meta.terminal.id,
            worktreePath: runtime.meta.worktreePath,
            provider: nextType,
            ptyId: runtime.ptyId,
          })
          .catch((error: unknown) => {
            console.error(
              "[terminalRuntime] telemetry provider update failed:",
              error,
            );
          });
      }
      if (nextType === "tmux" && result?.sessionName) {
        setSessionId(runtime, result.sessionName);
        return;
      }

      scheduleSessionCapture(runtime, runtime.ptyId!, nextType, result?.pid);
    });
  }, CLI_DETECTION_POLL_INTERVAL_MS);
}

function handleRuntimeOutput(runtime: ManagedTerminalRuntime, data: string) {
  appendPreview(runtime, data);
  runtime.xterm?.write(data);
  triggerDetection(runtime);

  if (!runtime.activityThrottled) {
    runtime.activityThrottled = true;
    dispatchWorktreeActivity(runtime.meta.worktreePath);
    runtime.activityTimer = setTimeout(() => {
      runtime.activityThrottled = false;
      runtime.activityTimer = null;
      if (runtime.activityPending) {
        runtime.activityPending = false;
        dispatchWorktreeActivity(runtime.meta.worktreePath);
      }
    }, WORKTREE_ACTIVITY_THROTTLE_MS);
  } else {
    runtime.activityPending = true;
  }

  if (runtime.currentStatus !== "active") {
    setStatus(runtime, "active");
  }

  if (runtime.waitingTimer) {
    clearTimeout(runtime.waitingTimer);
  }
  runtime.waitingTimer = setTimeout(() => {
    if (runtime.currentStatus === "active") {
      setStatus(runtime, "waiting");
      dispatchWorktreeActivity(runtime.meta.worktreePath);
    }
  }, SHELL_WAITING_AFTER_SILENCE_MS);
}

function buildTerminalRuntime(
  meta: TerminalRuntimeMeta,
): ManagedTerminalRuntime {
  const resolvedMeta = withResolvedRuntimeMeta(meta);
  const mode = resolveTerminalMountMode({
    focused: resolvedMeta.terminal.focused,
    visible: false,
  });
  const runtime: ManagedTerminalRuntime = {
    activityPending: false,
    activityTimer: null,
    activityThrottled: false,
    attachedContainer: null,
    attachOptions: null,
    backendKind: null,
    cliOverride:
      usePreferencesStore.getState().cliCommands[resolvedMeta.terminal.type] ??
      undefined,
    currentStatus: resolvedMeta.terminal.status,
    detectAttempts: 0,
    detectTimer: null,
    disposed: false,
    fitAddon: null,
    ghosttyBackend: null,
    globalDisposers: [],
    hasRespawned: false,
    hostElement: null,
    inputDisposable: null,
    meta: resolvedMeta,
    mode,
    outputUnsubscribe: null,
    ptyId: resolvedMeta.terminal.ptyId,
    ptyPromise: null,
    previewAnsi: clampPreviewAnsi(resolvedMeta.terminal.scrollback ?? ""),
    rendererPromise: null,
    hookFallbackTimer: null,
    lastPushAt: 0,
    lastTurnCompletedAt: 0,
    removeHookSessionStarted: null,
    removeHookTurnComplete: null,
    removeHookStopFailure: null,
    removeTurnComplete: null,
    resizeDisposable: null,
    selectionAutoCopy: createTerminalSelectionAutoCopyState(),
    selectionDisposable: null,
    selectionPointerCleanup: null,
    serializeAddon: null,
    sessionCancel: null,
    started: false,
    telemetryTimer: null,
    usesAgentRenderer: false,
    waitingTimer: null,
    wasResumeAttempt:
      !!resolvedMeta.terminal.sessionId &&
      !!getTerminalLaunchOptions(
        resolvedMeta.terminal.type,
        resolvedMeta.terminal.sessionId,
        resolvedMeta.terminal.autoApprove,
        usePreferencesStore.getState().cliCommands[
          resolvedMeta.terminal.type
        ] ?? undefined,
      ),
    watchedSessionId: null,
    xterm: null,
  };

  updateRuntimeSnapshot(resolvedMeta.terminal.id, {
    mode,
    previewText: toPreviewText(runtime.previewAnsi),
    telemetry: null,
  });

  return runtime;
}

async function spawnPty(
  runtime: ManagedTerminalRuntime,
  resumeSessionId?: string,
) {
  const launch = getTerminalLaunchOptions(
    runtime.meta.terminal.type,
    resumeSessionId,
    runtime.meta.terminal.autoApprove,
    runtime.cliOverride,
  );
  const options: {
    args?: string[];
    cwd: string;
    shell?: string;
    terminalId: string;
    terminalType: string;
    theme: "dark" | "light";
  } = {
    cwd: runtime.meta.worktreePath,
    terminalId: runtime.meta.terminal.id,
    terminalType: runtime.meta.terminal.type,
    theme: useThemeStore.getState().theme,
  };

  if (launch) {
    const promptArgs =
      !resumeSessionId && runtime.meta.terminal.initialPrompt
        ? getTerminalPromptArgs(
            runtime.meta.terminal.type,
            runtime.meta.terminal.initialPrompt,
          )
        : [];
    options.shell = launch.shell;
    options.args = [...launch.args, ...promptArgs];
  }

  // Register hook listener BEFORE spawning pty to avoid race condition (C2)
  let hookSessionReceived = false;
  const isHookEnabled =
    (runtime.meta.terminal.type === "claude" ||
      runtime.meta.terminal.type === "codex" ||
      runtime.meta.terminal.type === "shell") &&
    !!window.termcanvas?.hooks;

  if (!resumeSessionId && launch && isHookEnabled) {
    runtime.removeHookSessionStarted?.();
    runtime.removeHookSessionStarted =
      window.termcanvas!.hooks.onSessionStarted((payload) => {
        if (payload.terminalId !== runtime.meta.terminal.id) return;
        if (runtime.disposed || hookSessionReceived) return;
        hookSessionReceived = true;

        // Cancel polling fallback
        runtime.sessionCancel?.();
        if (runtime.hookFallbackTimer) {
          clearTimeout(runtime.hookFallbackTimer);
          runtime.hookFallbackTimer = null;
        }

        if (runtime.meta.terminal.type === "shell") {
          setTerminalType(runtime, "claude");
          useQuotaStore.getState().nudge();
          void window
            .termcanvas!.telemetry.updateTerminal({
              terminalId: runtime.meta.terminal.id,
              worktreePath: runtime.meta.worktreePath,
              provider: "claude",
              ptyId: runtime.ptyId,
            })
            .catch(() => {});
        }

        const hookSessionType =
          runtime.meta.terminal.type === "codex" ? "codex" : "claude";
        setSessionId(runtime, payload.sessionId);
        watchSession(runtime, hookSessionType, payload.sessionId, "strong");
        void syncPermissionMode(runtime, payload.sessionId);
      });
  }

  try {
    const ptyId = await window.termcanvas.terminal.create(options);
    if (runtime.disposed) {
      await window.termcanvas.terminal.destroy(ptyId);
      return;
    }

    setPtyId(runtime, ptyId);
    setStatus(runtime, "running");

    if (resumeSessionId && isSessionTelemetryProvider(runtime.meta.terminal.type)) {
      watchSession(runtime, runtime.meta.terminal.type, resumeSessionId);
    }

    if (!resumeSessionId && launch) {
      if (
        isHookEnabled &&
        (runtime.meta.terminal.type === "claude" ||
          runtime.meta.terminal.type === "codex")
      ) {
        // Hook is primary for claude/codex; fall back to polling if no hook event.
        runtime.hookFallbackTimer = setTimeout(() => {
          runtime.hookFallbackTimer = null;
          if (!hookSessionReceived && !runtime.disposed) {
            console.warn(
              `[TerminalRuntime] Hook session fallback triggered for terminal=${runtime.meta.terminal.id}`,
            );
            scheduleSessionCapture(runtime, ptyId, runtime.meta.terminal.type);
          }
        }, HOOK_SESSION_FALLBACK_MS);
      } else if (runtime.meta.terminal.type !== "shell") {
        scheduleSessionCapture(runtime, ptyId, runtime.meta.terminal.type);
      }
    }

    wireInteractiveBindings(runtime);
    syncAttachedTerminalGeometry(runtime);
  } catch (error) {
    if (runtime.hookFallbackTimer) {
      clearTimeout(runtime.hookFallbackTimer);
      runtime.hookFallbackTimer = null;
    }
    const message = error instanceof Error ? error.message : String(error);
    const t = getT();
    notify(
      "error",
      t.failed_create_pty(
        getTerminalDisplayTitle(runtime.meta.terminal),
        message,
      ),
    );
    setStatus(runtime, "error");
    appendPreview(
      runtime,
      `\r\n\x1b[31m[Error] Failed to create terminal: ${message}\x1b[0m\r\n`,
    );
  }
}

function startTerminalRuntime(runtime: ManagedTerminalRuntime) {
  if (runtime.started || runtime.disposed || !window.termcanvas) {
    return;
  }

  runtime.started = true;
  setupRuntimeSubscriptions(runtime);
  refreshTelemetry(runtime);

  const telemetryTick = () => {
    refreshTelemetry(runtime);
    const pushStale =
      runtime.lastPushAt > 0 &&
      Date.now() - runtime.lastPushAt > TELEMETRY_PUSH_STALE_MS;
    const currentInterval = pushStale
      ? TELEMETRY_POLL_FAST_MS
      : TELEMETRY_POLL_SLOW_MS;
    if (runtime.telemetryTimer) clearInterval(runtime.telemetryTimer);
    runtime.telemetryTimer = setInterval(telemetryTick, currentInterval);
  };
  runtime.telemetryTimer = setInterval(telemetryTick, TELEMETRY_POLL_SLOW_MS);

  // Push-based telemetry: immediate updates from hook events
  if (window.termcanvas.telemetry?.onSnapshotChanged) {
    let prevTurnState: string | undefined;
    const removePush = window.termcanvas.telemetry.onSnapshotChanged(
      (payload) => {
        if (payload.terminalId !== runtime.meta.terminal.id) return;
        if (runtime.disposed) return;
        runtime.lastPushAt = Date.now();

        const snap = payload.snapshot as TerminalTelemetrySnapshot;

        if (
          snap.turn_state === "turn_complete" &&
          prevTurnState !== "turn_complete"
        ) {
          onTerminalTurnCompleted(runtime.meta.terminal.id);
        }
        prevTurnState = snap.turn_state;

        updateRuntimeSnapshot(runtime.meta.terminal.id, {
          telemetry: snap,
        });
      },
    );
    runtime.globalDisposers.push(removePush);
  }

  runtime.outputUnsubscribe = window.termcanvas.terminal.onOutput(
    (ptyId, data) => {
      if (ptyId !== runtime.ptyId) {
        return;
      }

      handleRuntimeOutput(runtime, data);
    },
  );

  const exitUnsubscribe = window.termcanvas.terminal.onExit(
    (ptyId, exitCode) => {
      if (ptyId !== runtime.ptyId) {
        return;
      }

      if (runtime.waitingTimer) {
        clearTimeout(runtime.waitingTimer);
        runtime.waitingTimer = null;
      }

      if (exitCode !== 0 && runtime.wasResumeAttempt && !runtime.hasRespawned) {
        runtime.hasRespawned = true;
        clearWatchedSession(runtime);
        setSessionId(runtime, undefined);
        const expiredNotice =
          "\r\n\x1b[33m[Session expired, starting fresh...]\x1b[0m\r\n";
        appendPreview(runtime, expiredNotice);
        runtime.xterm?.write(expiredNotice);
        void spawnPty(runtime);
        return;
      }

      // When a CLI tile's PTY exits (graceful or otherwise), keep the tile alive
      // by demoting it to a plain user shell in the same xterm. This fixes the
      // long-standing "restored CLI dies on Ctrl+C with no fallback shell" bug:
      // restored CLI tiles spawn the CLI as PID 1 (no parent shell), so killing
      // the CLI used to leave the tile dead. Now we transparently fall back.
      if (runtime.meta.terminal.type !== "shell") {
        const previousType = runtime.meta.terminal.type;
        clearWatchedSession(runtime);
        setSessionId(runtime, undefined);
        runtime.removeHookSessionStarted?.();
        runtime.removeHookSessionStarted = null;
        if (runtime.hookFallbackTimer) {
          clearTimeout(runtime.hookFallbackTimer);
          runtime.hookFallbackTimer = null;
        }
        runtime.sessionCancel?.();
        runtime.sessionCancel = null;
        runtime.wasResumeAttempt = false;
        runtime.hasRespawned = false;
        setTerminalType(runtime, "shell");
        // Note: we intentionally do not call telemetry.updateTerminal here.
        // `clearWatchedSession` already invoked `detachSession`, which flips
        // `session_attached` to false — that is the canonical signal that this
        // terminal no longer has a live CLI session. The cached `provider`
        // field is left untouched (telemetry-service.updateTerminal has no way
        // to clear it; passing `undefined` is a silent no-op).
        const fallbackNotice = `\r\n\x1b[2m[${previousType} exited with code ${exitCode}; dropped to shell]\x1b[0m\r\n`;
        appendPreview(runtime, fallbackNotice);
        runtime.xterm?.write(fallbackNotice);
        void spawnPty(runtime);
        return;
      }

      const nextStatus = exitCode === 0 ? "success" : "error";
      setStatus(runtime, nextStatus);
      appendPreview(runtime, getT().process_exited(exitCode));
      notify(
        exitCode === 0 ? "info" : "warn",
        getT().terminal_exited(
          getTerminalDisplayTitle(runtime.meta.terminal),
          exitCode,
        ),
      );
    },
  );

  const handleTurnComplete = () => {
    const now = Date.now();
    if (now - runtime.lastTurnCompletedAt < TURN_COMPLETE_DEDUP_MS) return;
    if (
      runtime.currentStatus !== "active" &&
      runtime.currentStatus !== "waiting"
    )
      return;
    runtime.lastTurnCompletedAt = now;
    setStatus(runtime, "completed");
  };

  runtime.removeTurnComplete = window.termcanvas.session.onTurnComplete(
    (sessionId) => {
      const terminal = lookupCurrentTerminal(runtime);
      if (terminal?.sessionId === sessionId) {
        handleTurnComplete();
      }
    },
  );

  if (window.termcanvas?.hooks) {
    runtime.removeHookTurnComplete = window.termcanvas.hooks.onTurnComplete(
      (payload) => {
        if (payload.terminalId !== runtime.meta.terminal.id) return;
        // Reject events from a stale CLI session: after a fallback-shell
        // demotion the terminal id is reused, so a delayed hook event from
        // the dead claude/codex run could otherwise corrupt the new shell's
        // status. The terminal's current sessionId is the source of truth.
        if (
          payload.sessionId &&
          payload.sessionId !== runtime.meta.terminal.sessionId
        ) {
          return;
        }
        handleTurnComplete();
      },
    );

    runtime.removeHookStopFailure = window.termcanvas.hooks.onStopFailure(
      (payload) => {
        if (payload.terminalId !== runtime.meta.terminal.id) return;
        if (
          payload.sessionId &&
          payload.sessionId !== runtime.meta.terminal.sessionId
        ) {
          return;
        }
        if (payload.error) {
          setStatus(runtime, "error");
          appendPreview(
            runtime,
            `\r\n\x1b[31m[Hook error: ${payload.error}]\x1b[0m\r\n`,
          );
        }
      },
    );
  }

  runtime.globalDisposers.push(exitUnsubscribe);

  const doSpawn = () => {
    if (runtime.disposed) return;
    runtime.ptyPromise = spawnPty(
      runtime,
      runtime.meta.terminal.sessionId,
    ).finally(() => {
      runtime.ptyPromise = null;
    });
  };

  // For restored Claude/Codex sessions, read permission state from the
  // JSONL before spawning so the bypass flag is included in launch args.
  const needsPermissionSync =
    (runtime.meta.terminal.type === "claude" ||
      runtime.meta.terminal.type === "codex") &&
    !!runtime.meta.terminal.sessionId &&
    !runtime.meta.terminal.autoApprove;

  const scheduleSpawn = (spawn: () => void) => {
    const delay = runtime.meta.terminal.focused ? 0 : nextSpawnDelay();
    if (delay > 0) {
      setTimeout(spawn, delay);
    } else {
      spawn();
    }
  };

  if (needsPermissionSync) {
    void syncPermissionMode(runtime, runtime.meta.terminal.sessionId!).then(
      () => scheduleSpawn(doSpawn),
    );
  } else {
    scheduleSpawn(doSpawn);
  }
}

export function ensureTerminalRuntime(meta: TerminalRuntimeMeta) {
  const resolvedMeta = withResolvedRuntimeMeta(meta);
  const existing = runtimeRegistry.get(meta.terminal.id);
  if (existing) {
    existing.meta = resolvedMeta;
    existing.cliOverride =
      usePreferencesStore.getState().cliCommands[resolvedMeta.terminal.type] ??
      undefined;
    if (!existing.previewAnsi && resolvedMeta.terminal.scrollback) {
      pushPreview(existing, resolvedMeta.terminal.scrollback);
    }
    startTerminalRuntime(existing);
    return existing;
  }

  const runtime = buildTerminalRuntime(resolvedMeta);
  runtimeRegistry.set(meta.terminal.id, runtime);
  startTerminalRuntime(runtime);
  return runtime;
}

export function updateTerminalRuntime(meta: TerminalRuntimeMeta) {
  const resolvedMeta = withResolvedRuntimeMeta(meta);
  const runtime = ensureTerminalRuntime(resolvedMeta);
  runtime.meta = resolvedMeta;
  runtime.cliOverride =
    usePreferencesStore.getState().cliCommands[resolvedMeta.terminal.type] ??
    undefined;

  if (!runtime.previewAnsi && resolvedMeta.terminal.scrollback) {
    pushPreview(runtime, resolvedMeta.terminal.scrollback);
  }
}

export function setTerminalRuntimeMode(
  terminalId: string,
  mode: TerminalMountMode,
) {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime || runtime.mode === mode) {
    updateRuntimeSnapshot(terminalId, { mode });
    return;
  }

  runtime.mode = mode;
  updateRuntimeSnapshot(terminalId, { mode });

  if (mode === "live") {
    return;
  }

  if (mode === "evicted") {
    runtime.xterm?.blur();
    detachTerminalRenderer(runtime);
    return;
  }

  parkTerminalRenderer(runtime);
}

export function attachTerminalContainer(
  terminalId: string,
  container: HTMLDivElement,
  options: AttachOptions = {},
) {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime || runtime.disposed) {
    return;
  }

  runtime.attachOptions = options;
  if (runtime.usesAgentRenderer) {
    return;
  }

  if (!runtime.xterm) {
    if (runtime.rendererPromise) {
      // An async renderer init is already in flight (ghostty WASM load).
      // React strict-mode double-invokes effects, which would otherwise
      // kick off a second backend here — ending with two canvases fighting
      // for the same container. Just ensure the host sits in the latest
      // container and let the pending init finish.
      attachTerminalHost(runtime, container);
      return;
    }
    createTerminalRenderer(runtime, container);
    return;
  }

  const host = attachTerminalHost(runtime, container);
  if (!host) {
    return;
  }

  ensureRuntimeWebGL(runtime);
  wireRendererBindings(runtime, host);
  scheduleRuntimeRefresh(() => {
    syncAttachedTerminalGeometry(runtime);
    runtime.xterm?.refresh?.(0, (runtime.xterm?.rows ?? 1) - 1);
  });
}

export function detachTerminalContainer(terminalId: string) {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime) {
    return;
  }

  parkTerminalRenderer(runtime);
}

export function fitTerminalRuntime(terminalId: string) {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime?.xterm || runtime.ptyId === null) {
    return;
  }

  if (runtime.backendKind === "ghostty-wasm" && runtime.ghosttyBackend) {
    runtime.ghosttyBackend.fit();
  } else if (runtime.fitAddon) {
    runtime.fitAddon.fit();
  } else {
    return;
  }

  window.termcanvas.terminal.resize(
    runtime.ptyId,
    runtime.xterm.cols,
    runtime.xterm.rows,
  );
}

export function focusTerminalRuntime(terminalId: string): boolean {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime?.xterm) {
    return false;
  }

  runtime.xterm.focus();
  return true;
}

export function blurTerminalRuntime(terminalId: string): boolean {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime?.xterm) {
    return false;
  }

  runtime.xterm.blur();
  return true;
}

export function selectAllTerminalRuntime(terminalId: string): boolean {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime?.xterm) {
    return false;
  }

  runtime.xterm.selectAll();
  return true;
}

export function touchTerminalRuntime(terminalId: string) {
  if (runtimeRegistry.get(terminalId)?.xterm) {
    touchWebGL(terminalId);
  }
}

export function getTerminalRuntimePreviewAnsi(
  terminalId: string,
): string | null {
  return runtimeRegistry.get(terminalId)?.previewAnsi ?? null;
}

export function serializeAllTerminalRuntimeBuffers(): Record<string, string> {
  const serialized: Record<string, string> = {};

  for (const [terminalId, runtime] of runtimeRegistry) {
    const liveSerialized = serializeTerminal(terminalId);
    serialized[terminalId] = liveSerialized ?? runtime.previewAnsi;
  }

  return serialized;
}

export function destroyTerminalRuntime(terminalId: string) {
  const runtime = runtimeRegistry.get(terminalId);
  if (!runtime) {
    removeRuntimeSnapshot(terminalId);
    return;
  }

  runtime.disposed = true;
  clearRuntimeTimers(runtime);
  runtime.sessionCancel?.();
  runtime.sessionCancel = null;
  runtime.xterm?.blur();
  detachTerminalRenderer(runtime);
  clearWatchedSession(runtime);

  runtime.outputUnsubscribe?.();
  runtime.outputUnsubscribe = null;
  runtime.removeTurnComplete?.();
  runtime.removeTurnComplete = null;
  if (runtime.hookFallbackTimer) {
    clearTimeout(runtime.hookFallbackTimer);
    runtime.hookFallbackTimer = null;
  }
  runtime.removeHookSessionStarted?.();
  runtime.removeHookSessionStarted = null;
  runtime.removeHookTurnComplete?.();
  runtime.removeHookTurnComplete = null;
  runtime.removeHookStopFailure?.();
  runtime.removeHookStopFailure = null;

  for (const dispose of runtime.globalDisposers) {
    dispose();
  }
  runtime.globalDisposers = [];

  if (runtime.ptyId !== null) {
    const ptyId = runtime.ptyId;
    setPtyId(runtime, null);
    void window.termcanvas.terminal.destroy(ptyId).catch((error) => {
      console.error(`[terminalRuntime] failed to destroy PTY ${ptyId}:`, error);
    });
  }

  runtimeRegistry.delete(terminalId);
  removeRuntimeSnapshot(terminalId);
}

export function destroyAllTerminalRuntimes() {
  for (const terminalId of [...runtimeRegistry.keys()]) {
    destroyTerminalRuntime(terminalId);
  }
}

export function getTerminalPtyId(terminalId: string): number | null {
  const runtime = runtimeRegistry.get(terminalId);
  return runtime?.ptyId ?? null;
}

export type { ManagedTerminalRuntime };

export function getTerminalRuntime(
  terminalId: string,
): ManagedTerminalRuntime | null {
  return runtimeRegistry.get(terminalId) ?? null;
}

/**
 * Re-read sessionId (from sidecar) and permissionMode (from JSONL) for
 * every live Claude terminal.  Call this before building a save snapshot
 * so that /resume switches and Shift+T toggles are captured.
 */
export async function refreshClaudeSessionStates(): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const runtime of runtimeRegistry.values()) {
    if (
      runtime.disposed ||
      runtime.meta.terminal.type !== "claude" ||
      runtime.ptyId === null
    ) {
      continue;
    }

    tasks.push(
      (async () => {
        const pid = await window.termcanvas.terminal.getPid(runtime.ptyId!);
        if (!pid || runtime.disposed) return;

        const latestSessionId =
          await window.termcanvas.session.getClaudeByPid(pid);
        if (runtime.disposed) return;

        if (
          latestSessionId &&
          latestSessionId !== runtime.meta.terminal.sessionId
        ) {
          setSessionId(runtime, latestSessionId);
        }

        // Re-read permissionMode from JSONL
        const sessionId = runtime.meta.terminal.sessionId;
        if (sessionId) {
          await syncPermissionMode(runtime, sessionId);
        }
      })(),
    );
  }

  await Promise.all(tasks);
}
