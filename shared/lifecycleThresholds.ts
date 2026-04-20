/**
 * Lifecycle thresholds — single source of truth for every timing constant
 * that drives terminal state detection and the pet's reactions.
 *
 * Why this file exists
 * --------------------
 * Status detection lives in three layers that must agree: the PTY-level
 * runtime store (renderer), the telemetry service (main process), and the
 * session panel / pet event bridge (renderer UI). Before this file, each
 * layer pulled its thresholds from its own magic numbers; tuning one
 * without the others produced silent drift between "the pet thinks it's
 * idle" and "the panel says it's still working". Centralizing them:
 *   - makes every threshold discoverable in one place,
 *   - forces us to justify each number in prose,
 *   - makes the system tunable (future: hoist to user preferences).
 *
 * How to pick values
 * ------------------
 * Each constant below includes WHAT it controls, the rough WHY for the
 * current value, and a WHEN-TO-TUNE hint. If you're about to add a new
 * timing constant anywhere in the lifecycle stack, add it here first.
 *
 * Numbers are in milliseconds unless suffixed otherwise.
 */

// ---------------------------------------------------------------------------
// Session attachment — finding the CLI's session file after launch
// ---------------------------------------------------------------------------

/**
 * Per-CLI poll cadence for locating the CLI's session id after spawn.
 * Codex writes its session file quickly but we also need fine-grained
 * timestamp discrimination, so we poll fast with a moderate attempt cap.
 * Wuu writes eagerly and the UX benefits from fast attach. Claude and
 * unclassified types fall back to the slow path.
 *
 * Tune when: adding a new CLI, or if users report "session never
 * attached" on a new agent.
 */
export const SESSION_POLL_INTERVAL_MS = {
  codex: 500,
  wuu: 1_000,
  default: 5_000,
} as const;

/**
 * Per-CLI cap on how many times we re-poll for the session id before
 * giving up. Multiplied by SESSION_POLL_INTERVAL_MS this bounds the
 * total attachment window:
 *   codex: 20 * 500ms   = 10s
 *   wuu:   120 * 1000ms = 120s
 *   other: 10 * 5000ms  = 50s
 *
 * Tune when: the CLI takes noticeably longer than usual to write its
 * session file (CI cold starts, slow disks).
 */
export const SESSION_POLL_MAX_ATTEMPTS = {
  codex: 20,
  wuu: 120,
  default: 10,
} as const;

/**
 * How long we wait for the hook-based session pipeline (Claude/Codex
 * hooks) before falling back to filesystem polling. Hooks are faster
 * and preferred; this is purely a safety net.
 *
 * Tune when: hook delivery is flaky — lower to recover sooner, raise
 * to avoid duplicate capture paths firing in parallel.
 */
export const HOOK_SESSION_FALLBACK_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI detection — classifying a bare shell as claude / codex / wuu / …
// ---------------------------------------------------------------------------

/**
 * How often we call `detectCli(ptyId)` to probe whether a shell has
 * morphed into a known agent. Polling fires on terminal output, not on
 * a timer, but this is the minimum interval between probes so we don't
 * hammer the main process during heavy output.
 *
 * Tune when: detection is missing agent launches (lower) or CPU spikes
 * during rapid output (raise).
 */
export const CLI_DETECTION_POLL_INTERVAL_MS = 3_000;

/**
 * Maximum detection attempts. At the default 3 s cadence this bounds
 * the effective detection window to ~90 s, which is enough for cold
 * agent starts without keeping the detector alive forever on a terminal
 * that really is just a shell.
 *
 * Tune when: agents frequently take longer than 90 s to show CLI
 * signatures in their output.
 */
export const CLI_DETECTION_MAX_ATTEMPTS = 30;

// ---------------------------------------------------------------------------
// Shell-level activity — raw PTY output drives "active" vs "waiting"
// ---------------------------------------------------------------------------

/**
 * Output-silence budget before a terminal that was "active" downgrades
 * to "waiting". This is PTY-level (no output = nothing is happening),
 * independent of the richer telemetry-derived status. Too low and
 * shells that legitimately idle (waiting on the user at a prompt) flap
 * the status flag; too high and genuinely stalled tools look alive.
 *
 * Tune when: users report flapping "waiting" flags on interactive
 * prompts (raise), or when stalled agents take too long to be flagged
 * at the PTY layer (lower).
 */
export const SHELL_WAITING_AFTER_SILENCE_MS = 30_000;

/**
 * Minimum gap between worktree-activity dispatches from the same
 * terminal. Pure performance guard — avoids storming the activity
 * listeners during heavy output bursts.
 *
 * Tune when: the worktree activity UI feels laggy (lower) or is being
 * overwhelmed on high-throughput terminals (raise).
 */
export const WORKTREE_ACTIVITY_THROTTLE_MS = 3_000;

// ---------------------------------------------------------------------------
// Telemetry polling — pull cadence for per-terminal snapshots
// ---------------------------------------------------------------------------

/**
 * Default telemetry pull cadence. Hook-pushed snapshots usually arrive
 * faster than this; the pull loop exists as a safety net for CLIs or
 * environments where hooks aren't wired up.
 */
export const TELEMETRY_POLL_SLOW_MS = 30_000;

/**
 * Fallback telemetry pull cadence when hook pushes have gone silent
 * for longer than {@link TELEMETRY_PUSH_STALE_MS}. Ramps up the pull
 * frequency so we don't let state drift while hooks are broken.
 */
export const TELEMETRY_POLL_FAST_MS = 5_000;

/**
 * How long we tolerate zero hook-pushed snapshots before switching
 * from SLOW to FAST polling. Should be at least a couple multiples of
 * the expected push cadence to avoid thrashing.
 */
export const TELEMETRY_PUSH_STALE_MS = 60_000;

// ---------------------------------------------------------------------------
// Telemetry-derived status — stall detection & session heartbeat
// ---------------------------------------------------------------------------

/**
 * Claude: no meaningful progress for this long → `stall_candidate`.
 * "Meaningful progress" means token growth, tool activity, or a process
 * change — not just more terminal output. Claude responses are typically
 * second-to-second so 45 s is a comfortable outer bound.
 *
 * Tune when: Claude stalls are flagged too aggressively on legitimately
 * slow responses (raise), or real stalls slip through for too long
 * (lower).
 */
export const DEFAULT_CLAUDE_STALL_MS = 45_000;

/**
 * Codex: same semantic as Claude, but Codex is more variable —
 * individual tool invocations can take a couple of minutes without
 * progress. 180 s is an empirical compromise; drop it only if you've
 * verified Codex completions don't falsely trip the stall flag.
 */
export const DEFAULT_CODEX_STALL_MS = 180_000;

/**
 * Advisory stall thresholds used by the hydra watch loop when deciding
 * whether to surface a stall_advisory DecisionPoint. The *_STALL_MS
 * constants drive UI status ("stall_candidate"), which is deliberately
 * aggressive so the canvas can flag slow agents early. Promoting that
 * signal to a control-flow decision — one that interrupts the Lead —
 * demands a much more conservative threshold: by the time we advise the
 * Lead to intervene, we want to be fairly sure the worker has stopped
 * making progress, not just that it is in a long tool call.
 *
 * 3× is an intentional multiplier, not a round-number choice. Two
 * observed stall windows in a row already carry enough signal that the
 * worker is unlikely to recover on its own. Raise this when advisories
 * fire on legitimate long tool calls; lower it only when real stalls
 * routinely slip past unnoticed.
 */
export const STALL_ADVISORY_MULTIPLIER = 3;
export const DEFAULT_CLAUDE_STALL_ADVISORY_MS =
  DEFAULT_CLAUDE_STALL_MS * STALL_ADVISORY_MULTIPLIER;
export const DEFAULT_CODEX_STALL_ADVISORY_MS =
  DEFAULT_CODEX_STALL_MS * STALL_ADVISORY_MULTIPLIER;

/**
 * Session heartbeat staleness: how long a `turn_state: "in_turn"`
 * snapshot is trusted before we start second-guessing it. Guards
 * against a session getting stuck "thinking" after the backend has
 * quietly exited.
 */
export const DEFAULT_SESSION_HEARTBEAT_MS = 90_000;

/**
 * How often the main-process telemetry service polls `/proc` for
 * per-terminal process state. Cheap on Linux but not free; balances
 * responsiveness of foreground-tool detection vs. CPU overhead.
 */
export const DEFAULT_PROCESS_POLL_INTERVAL_MS = 15_000;

/**
 * How often the main-process telemetry service re-reads the CLI's
 * session file for new events. Hook push is the fast path; this is the
 * fallback for sessions without hook wiring.
 */
export const DEFAULT_SESSION_POLL_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Tool tracking — PreToolUse / PostToolUse pairing heuristics
// ---------------------------------------------------------------------------

/**
 * Claude Code: fallback silence window after `PreToolUse` before we
 * assume the agent is blocked on user approval.
 *
 * Claude Code emits a `Notification` hook when a permission / user
 * elicitation prompt needs attention (see `recordHookEvent` →
 * `"Notification"`), and that hook is the primary signal for flipping
 * `turn_state` to `"awaiting_input"`. This timer is ONLY a safety net
 * for the rare case where a Notification doesn't fire (older Claude
 * Code builds, hook drop, or a brand-new prompt flavor we haven't
 * seen).
 *
 * Because it's a backstop — not the primary signal — we keep it wide
 * enough that ordinary long tools (slow Bash, large edits) don't trip
 * it. If Notification coverage is high, you can raise this further or
 * remove the timer entirely.
 */
export const CLAUDE_PRE_TOOL_USE_FALLBACK_MS = 30_000;

/**
 * Codex: PreToolUse silence window before we flag `turn_state` as
 * `"awaiting_input"`.
 *
 * Codex does NOT emit a `Notification` hook for approval prompts — its
 * approval UI is pure terminal output. So the hook pipeline has no
 * direct way to know "user is being asked to approve this exec" apart
 * from observing "Codex ran PreToolUse, then nothing happened for a
 * while".
 *
 * 20 s is a compromise: fast enough that a real approval prompt makes
 * the pet react within a sensible window, slow enough that ordinary
 * Codex Bash commands (tests, long builds) don't false-positive too
 * often. If you want to eliminate false positives, raise this to 30s+
 * at the cost of delayed pet reactions; if you can wire up a real
 * Codex approval signal, delete this timer in favor of that signal.
 */
export const CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS = 20_000;

/**
 * Fallback cleanup: if a PreToolUse has been pending for this long
 * without a PostToolUse, assume the agent crashed mid-tool and reset
 * our internal pendingPreToolUse flag. This is a last-resort recovery
 * — 5 minutes is generous to avoid racing real slow tools.
 */
export const PRE_TOOL_USE_STALE_RESET_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Event dedup / debounce — avoid double-firing status changes
// ---------------------------------------------------------------------------

/**
 * Back-to-back "turn_complete" events arriving within this window
 * collapse into a single one. Prevents duplicate celebrations / pet
 * events when a CLI emits redundant signals.
 */
export const TURN_COMPLETE_DEDUP_MS = 5_000;

/**
 * Debounce before auto-summarizing after a turn completes. Short gap
 * lets rapid-fire completions coalesce into one summary request.
 */
export const TURN_COMPLETE_SUMMARY_DEBOUNCE_MS = 5_000;

/**
 * How often the auto-summary watcher sweeps idle terminals looking
 * for ones that warrant a fresh summary. Loose cadence because summary
 * work is expensive.
 */
export const AUTO_SUMMARY_SWEEP_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Pet event bridge — how often the pet polls non-push signals
// ---------------------------------------------------------------------------

/**
 * Hydra workflow-state refresh cadence for the pet event bridge.
 * Workflows don't push to the renderer, so the pet pulls at this rate
 * to know whether to play the "commanding" pose. Keep well below the
 * TURN_COMPLETE_DEDUP window.
 */
export const WORKFLOW_REFRESH_INTERVAL_MS = 5_000;

/**
 * Pet idle ticker — drives `TIMER` events that the pet state machine
 * uses for sleep / waking transitions. 1 Hz is fine because the
 * downstream thresholds are all in the tens of seconds or more.
 */
export const PET_IDLE_TICK_MS = 1_000;
