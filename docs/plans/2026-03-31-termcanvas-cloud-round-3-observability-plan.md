# TermCanvas Cloud Round 3 Observability Implementation Plan

> **Execution note:** Use `executing-plans` to implement this plan task-by-task, or another equivalent execution workflow supported by the current agent runtime.

**Goal:** Finish Round 3 observability work on top of the existing partial implementation without regressing the headless runtime or leaking terminal data.

**Architecture:** Keep `HeadlessApiServer` as the main API surface, but separate public observability data from terminal-private streaming data. Use the existing `ServerEventBus` for lifecycle fanout, add a workflow inventory helper sourced from Hydra workflow records, and extract a shared outbound notification transport so webhook delivery and heartbeat use the same retry/signing/error-handling path.

**Tech Stack:** TypeScript, Node.js `http`/`fs`/`crypto`, `EventEmitter`, Hydra workflow-store utilities, `tsx --test`, `tsc`

---

## Problems Found

- **P1. Headless validation baseline is already broken.**
  `npm run typecheck:headless` currently fails at `electron/process-detector.ts:339` because `detectCli()` returns `autoApprove` even though the declared return type does not include that property. Round 3 cannot be verified cleanly until this baseline failure is removed.

- **P2. `/health` is still missing required workflow data and misreports disk usage semantics.**
  `headless-runtime/api-server.ts:210-233` now returns version, platform, memory, and terminal summary, but it still omits active Hydra workflow count. Its `disk_usage_bytes` value is populated from `fs.statfsSync()` in `headless-runtime/api-server.ts:961-970`, which measures filesystem occupancy, not workspace-directory usage.

- **P3. `/api/status` is still a placeholder instead of a dashboard-ready state snapshot.**
  `headless-runtime/api-server.ts:893-910` returns only minimal terminal fields, recent events, and a `server.host` field that is literally `undefined`. It does not include active workflow data or a complete sanitized config snapshot.

- **P4. Lifecycle event delivery is incomplete.**
  `server_started` is emitted in `headless-runtime/index.ts:151` before `WebhookService` subscribes in `headless-runtime/index.ts:161-170`, so the startup notification is dropped whenever webhooks are enabled. `server_stopping` is never emitted, and no code emits `workflow_started`, `workflow_completed`, or `workflow_failed`.

- **P5. The SSE endpoint does not yet stream the data the contract requires.**
  `headless-runtime/api-server.ts:667-674` emits `terminal_output` events with only `{terminalId, bytes}` and never emits terminal status transitions. The SSE handler in `headless-runtime/api-server.ts:915-956` therefore cannot stream real terminal output or state changes.

- **P6. Heartbeat is inconsistent with the new webhook path and still reports fake data.**
  `headless-runtime/heartbeat.ts:52-68` posts directly with its own fetch logic instead of sharing webhook transport behavior. In `headless-runtime/index.ts:178-190`, the heartbeat payload hardcodes `workflow_status: "running"`, sets `current_handoff: null`, and computes `uptime_seconds` as `Date.now() - Date.now()`, which always returns `0`.

- **P7. Webhook retry behavior does not match the stated contract.**
  `headless-runtime/webhook.ts:10-13` and `headless-runtime/webhook.ts:87-96` allow only three total sends, so the code can only schedule 1s and 4s retries. The required 16s retry window never occurs.

- **P8. There is no automated regression coverage for the new observability surfaces.**
  Repository search found no tests for `HeadlessApiServer`, `/health`, `/api/status`, the SSE endpoint, or `WebhookService`. The current partial implementation therefore has no regression net for the strict security and reliability requirements in the task contract.

- **P9. Deployment docs do not describe the new webhook configuration surface.**
  `server/.env.example` still lacks `TERMCANVAS_WEBHOOK_URL` and `TERMCANVAS_WEBHOOK_SECRET`, so container operators do not have a documented way to enable the new notification path.

## Constraints

- **C1.** `npm run typecheck:headless` must exit `0` before Round 3 is claimed complete.

- **C2.** `GET /health` must keep the existing `status`, `uptime_seconds`, and `active_terminals` fields and add `version`, `node_version`, `platform`, `active_workflows`, `terminal_status_summary`, `memory`, and workspace-scoped `disk_usage_bytes`.

- **C3.** `disk_usage_bytes` must represent bytes used by `workspaceDir` itself. Returning whole-filesystem occupancy under that field name is not allowed.

- **C4.** `GET /health/live` always returns `200`, and `GET /health/ready` returns `200` or `503` based on server readiness. Both remain unauthenticated. Other new observability endpoints stay behind the existing auth gate.

- **C5.** `GET /api/status` must return all terminals, active workflow summaries and/or count, recent public events capped at `50`, and non-sensitive config only. It must not return API tokens, webhook secrets, provider keys, PTY IDs, or raw terminal output.

- **C6.** `GET /api/terminal/:id/events` may only emit events for `:id`. Cross-terminal leakage is a blocking defect.

- **C7.** SSE payloads must include real output chunks and terminal state transitions. Byte-count-only events are insufficient.

- **C8.** No request handler, PTY callback, or shutdown entrypoint may `await` webhook delivery. Webhook dispatch stays fire-and-forget in hot paths.

- **C9.** Webhook retry behavior is initial send plus three retries with delays of `1s`, `4s`, and `16s`. Delivery failures must be caught and logged internally and must never throw back into callers.

- **C10.** Lifecycle notifications must include `server_started`, `server_stopping`, `workflow_started`, `workflow_completed`, and `workflow_failed` with real runtime triggers.

- **C11.** Heartbeat and webhook delivery must share the same outbound signing, timeout, retry, and error-handling code path. Heartbeat payload values must come from real runtime state.

- **C12.** In-memory observability buffers must stay bounded. Public recent events stay capped, terminal-private output/history stays capped per terminal, SSE listeners are cleaned up on disconnect, and connection caps stay enforced.

- **C13.** If any docs or examples in this repo show verifying `X-Webhook-Signature`, they must use `crypto.timingSafeEqual`, not direct string comparison.

- **C14.** Final verification must include targeted tests for webhook, SSE, and health/status behavior plus the headless typecheck command.

- **C15.** `server/.env.example` must document `TERMCANVAS_WEBHOOK_URL`, `TERMCANVAS_WEBHOOK_SECRET`, and any new observability-related knobs introduced during implementation.

## Implementation Plan

### Step 1: Restore the headless validation baseline

**Files:**
- Modify: `electron/process-detector.ts`
- Verify: `npm run typecheck:headless`

**Problems:** `P1`

**Constraints:** `C1`, `C14`

**Action:** Align `detectCli()` return types with the current `autoApprove` field so the headless typecheck is green again before any Round 3 work is validated.

**Verify:** Run `npm run typecheck:headless` and confirm the existing baseline failure is gone.

### Step 2: Add a workflow inventory helper and sanitized server snapshot inputs

**Files:**
- Modify: `headless-runtime/api-server.ts`
- Optionally create: `headless-runtime/workflow-status.ts`
- Reuse: `hydra/src/workflow-store.ts`

**Problems:** `P2`, `P3`, `P4`

**Constraints:** `C2`, `C4`, `C5`, `C10`

**Action:** Introduce a helper that enumerates active workflows from tracked repo roots or telemetry-linked workflow IDs, and define a single sanitized server-config snapshot object that can be reused by `/health` and `/api/status`.

**Verify:** Unit-test the helper against representative workflow records and confirm sensitive fields are excluded from the config snapshot.

### Step 3: Split public recent events from terminal-private stream events

**Files:**
- Modify: `headless-runtime/event-bus.ts`
- Modify: `headless-runtime/api-server.ts`

**Problems:** `P5`, `P8`

**Constraints:** `C5`, `C6`, `C7`, `C12`

**Action:** Keep a bounded public recent-event buffer for `/api/status`, but add a separate bounded per-terminal event path for raw output and state transitions so SSE can stream terminal data without exposing that data through the public dashboard endpoint.

**Verify:** Add tests proving `/api/status` never includes raw terminal output while `/api/terminal/:id/events` still receives terminal-scoped output/state events.

### Step 4: Finish the health and status endpoints

**Files:**
- Modify: `headless-runtime/api-server.ts`

**Problems:** `P2`, `P3`

**Constraints:** `C2`, `C3`, `C4`, `C5`, `C12`

**Action:** Complete `/health`, `/health/live`, `/health/ready`, and `/api/status` using the new workflow inventory helper and a cached workspace-size calculator that measures the workspace directory itself instead of whole-filesystem usage.

**Verify:** Add tests for response shapes, auth boundaries, and workspace disk-size semantics.

### Step 5: Fix lifecycle wiring and webhook semantics

**Files:**
- Modify: `headless-runtime/index.ts`
- Modify: `headless-runtime/api-server.ts`
- Modify: `headless-runtime/webhook.ts`

**Problems:** `P4`, `P5`, `P7`

**Constraints:** `C8`, `C9`, `C10`, `C12`, `C13`

**Action:** Instantiate webhook delivery before emitting `server_started`, emit `server_stopping` during shutdown, emit workflow lifecycle transitions from workflow-linked terminal start/exit paths, and update retry counting so the notifier actually reaches the `1s`, `4s`, `16s` schedule.

**Verify:** Add tests around retry timing, lifecycle event emission, and fire-and-forget behavior. If documentation includes signature verification examples, confirm they use `timingSafeEqual`.

### Step 6: Unify heartbeat transport with webhook transport

**Files:**
- Modify: `headless-runtime/heartbeat.ts`
- Modify: `headless-runtime/webhook.ts`
- Optionally create: `headless-runtime/notification-transport.ts`
- Modify: `headless-runtime/index.ts`

**Problems:** `P6`, `P7`

**Constraints:** `C9`, `C10`, `C11`

**Action:** Extract a shared outbound notification transport for POST, timeout, retry, signing, and error logging. Use it in both `WebhookService` and `Heartbeat`, and replace the current fake heartbeat payload fields with real uptime/workflow/handoff data.

**Verify:** Add unit tests for heartbeat payload generation and shared transport retry/signature behavior.

### Step 7: Add targeted observability test coverage

**Files:**
- Create: `tests/headless-api-server-observability.test.ts`
- Create: `tests/headless-webhook.test.ts`
- Create: `tests/headless-sse.test.ts`

**Problems:** `P8`

**Constraints:** `C6`, `C7`, `C8`, `C9`, `C10`, `C11`, `C12`, `C14`

**Action:** Build focused tests for health/status response shapes, auth boundaries, terminal-scoped SSE output/state events, webhook retry scheduling, lifecycle emission, and heartbeat payload correctness.

**Verify:** Run the new targeted test files plus `npm run typecheck:headless`.

### Step 8: Update deployment-facing configuration docs

**Files:**
- Modify: `server/.env.example`
- Optionally modify: `server/Dockerfile`

**Problems:** `P9`

**Constraints:** `C4`, `C15`

**Action:** Document `TERMCANVAS_WEBHOOK_URL`, `TERMCANVAS_WEBHOOK_SECRET`, and any new observability settings. If the implementation keeps dedicated liveness/readiness probes, update container healthcheck usage to match the final endpoint contract.

**Verify:** Confirm every env var used by the final observability code path is documented in `server/.env.example`.
