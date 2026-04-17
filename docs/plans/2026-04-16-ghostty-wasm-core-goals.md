# Ghostty-WASM Core — Desired Outcomes

Date: 2026-04-16
Branch: `feat/ghostty-wasm-core`

## Why This Exists

TermCanvas is built to host coding-agent CLIs (Claude, Codex, etc.). These
agents generate heavy, bursty output with subtle VT sequences (alt screen,
cursor save/restore, OSC titles, shell integration). On Ghostty the rendering
of these agents is observably the most stable terminal available; inside
TermCanvas (xterm.js-based) it is not. Users notice.

We previously attempted a drop-in replacement with the `ghostty-web` NPM
package on `experiment/ghostty-web-spike` and regressed on performance. The
post-mortem conclusion is that we compared the wrong combinations: xterm.js
with its battle-tested WebGL renderer vs. Ghostty WASM core with a web-demo
renderer. The **core** was not the bottleneck — the **renderer** was.

This document states the outcomes we are committing to for the next attempt.
It does not prescribe the implementation path; that will be decided in a
follow-up spike.

## Desired Outcomes

### 1. Ghostty-Level Terminal Stability

TermCanvas terminals must behave indistinguishably from Ghostty for the
sequences coding agents actually emit, including edge cases that xterm.js
currently gets wrong.

Concretely:

- Alt-screen enter/exit during agent sessions never corrupts the primary
  scrollback.
- Cursor save/restore, DECSC/DECRC, and cursor-position reports round-trip
  exactly as Ghostty does.
- Wide characters (CJK), combining marks, emoji ZWJ sequences, and
  variation selectors render with the same cell width Ghostty uses.
- Scroll region, margin, and line-wrap semantics match Ghostty under
  sustained streaming output.
- OSC sequences used by shell integration and by Claude / Codex are parsed
  and surfaced the same way Ghostty surfaces them.
- Resize during high-throughput output does not desync cursor position or
  drop content.

Acceptance: a curated suite of VT / agent-session captures replays
byte-for-byte identical screen state between the new backend and Ghostty
itself.

### 2. Faster and Smoother Than the Current xterm.js Path

The new backend must not regress on performance vs. the current
xterm.js + `addon-webgl` stack. It should visibly beat it on the workloads
agents actually produce.

Concretely:

- Sustained agent output (streaming Claude / Codex sessions, `cat` of a
  large file, `tsc --noEmit`, build logs) maintains 60 fps on the
  renderer with no dropped frames at P95.
- Input-to-screen latency is no worse than xterm.js + `addon-webgl`.
- Scrolling a full scrollback buffer (both wheel and programmatic)
  stays at 60 fps.
- Memory footprint per idle terminal is within 1.5x of xterm.js; under
  long-running sessions it does not grow unboundedly faster than xterm.js
  does.
- Startup time per new terminal tile is within 1.2x of xterm.js once the
  WASM module is warm.

Acceptance: a benchmark harness that replays recorded agent sessions and
reports frame times, input latency, and memory over time — run against
both backends, with the new backend meeting or beating xterm.js on every
metric above.

### 3. Existing Functionality Is Preserved

No user-visible feature in TermCanvas regresses. The backend swap is
invisible except where it is strictly better.

Features that must continue to work without caveats:

- Terminal fit on resize, including mid-stream resizes.
- Scrollback restore across app restarts (serialization / replay).
- Theme switching at runtime, including contrast adjustments.
- Selection, copy, and the "consume shortcut before terminal input" rules.
- Direct keyboard handling, including IME composition and dead keys.
- Inline image support (the feature currently provided via `@xterm/addon-image`).
- Focus management and the cursor-blink-only-on-focused-tile rule.
- Terminal buffer inspection used by viewport and scroll-state logic.
- All terminal-related behaviors covered by existing regression tests
  under `tests/terminal-*`.

Acceptance: the full existing test suite passes with the new backend as
the default, and a manual QA pass against a checklist of user-visible
terminal features shows no regressions.

## Non-Goals

This effort is bounded. The following are explicitly **not** in scope:

- Shipping native libghostty on any platform.
- Replacing the PTY backend or process model.
- Changing TermCanvas UX beyond the terminal tile itself.
- New terminal features that Ghostty supports but TermCanvas does not
  currently expose.
- Windows / Linux parity investigations beyond "the new backend still
  works there". If it works equally well on all platforms, great; if it
  only matches xterm.js on Windows / Linux while beating it on macOS,
  that is acceptable for this milestone.

## Known Risks to These Outcomes

Stating these up front so that when the spike hits them we recognize
them as predicted, not as surprises.

1. **WASM ↔ JS boundary cost.** Naively shuttling pty bytes across the
   boundary kills throughput. The terminal core must accept batched input
   and expose screen state via shared memory, not per-call copies.
2. **Dirty region exposure.** The renderer needs cheap access to "what
   changed this frame". If the core does not expose this, we fall back
   to whole-screen diffing, which costs the perf goal.
3. **Renderer build from scratch is a trap.** Writing a WebGPU renderer
   that beats `@xterm/addon-webgl` on day one is unrealistic. An
   intermediate step that pairs the Ghostty core with an existing
   GPU-backed renderer (adapter onto `@xterm/addon-webgl` or equivalent)
   is likely the shortest path to the perf outcome.
4. **Feature parity surface is wider than it looks.** `addon-image`,
   serialization, IME, contrast adjustments, and the TermCanvas-specific
   focus / scroll rules each need an equivalent. Underestimating this
   list is how the previous spike lost time.
5. **Upstream drift.** Whatever form the Ghostty core takes (WASM build,
   vendored source, NPM package), we need an explicit story for pulling
   in upstream fixes without manual re-porting.

## What This Document Does Not Decide

- Whether the Ghostty core comes from the `ghostty-web` package, a
  custom Zig → WASM build of `src/terminal/`, or a vendored port.
- Whether the renderer is `@xterm/addon-webgl` adapted, a fresh
  WebGPU implementation, or a hybrid.
- The rollout strategy (flagged backend, per-terminal opt-in, full
  swap).

These are spike outputs, not preconditions. The next step is a time-boxed
spike that picks the lowest-risk combination meeting the three outcomes
above.
