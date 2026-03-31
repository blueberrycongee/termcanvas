# Round 4: Hydra Cloud Integration Plan

## Problems Found

- **P1. The remote control plane stops at telemetry reads.**
  `cli/termcanvas.ts` only exposes `project`, `terminal`, `telemetry`, `diff`, and `state`. `headless-runtime/api-server.ts` exposes workflow telemetry reads but has no workflow run/list/tick/status/retry/cleanup routes, so headless TermCanvas cannot start or control Hydra workflows through the HTTP API.

- **P2. Worktree lifecycle still assumes a GUI or direct git shell access.**
  The current headless API can rescan projects already on the canvas, but it cannot list/create/remove worktrees through the API or the `termcanvas` CLI. That leaves cloud users without a remote way to prepare or clean up worktrees.

- **P3. Hydra still depends on pre-existing canvas state.**
  `hydra/src/workflow.ts` only rescans after creating a worktree when the repo is already on the canvas, and `hydra/src/spawn.ts` fails immediately if `findProjectByPath(repo)` returns null. In headless mode this makes workflow dispatch fragile because terminal creation still requires the worktree to exist in TermCanvas state.

- **P4. Server-side Hydra control needs a stable loopback connection to the current headless runtime.**
  If the headless server handles workflow commands in-process, Hydra's internal `termcanvas` CLI calls must resolve back to the same server instance. Relying on externally supplied `TERMCANVAS_HOST=0.0.0.0` or missing port-file context is brittle for server-side control paths.

- **P5. New workflow/worktree surfaces have no regression net.**
  There are tests for Hydra internals and recent headless observability work, but no focused coverage for workflow-control routes, worktree-management routes, CLI parsing/requests for those new groups, or the project auto-registration path that makes headless Hydra reliable.

- **P6. API/CLI expansion can easily regress the Round 3 security contract.**
  New control routes must stay behind the existing auth gate, must not leak secrets or raw terminal output, and must not break the already-shipped `/health`, `/health/live`, `/health/ready`, `/api/status`, or telemetry surfaces.

## Constraints

- **C1. Headless workflow control must be remotely accessible.**
  The authenticated API must expose structured workflow operations sufficient to run, inspect, advance, retry, and clean up Hydra workflows without a GUI. The `termcanvas` CLI must map to those routes.

- **C2. Headless worktree lifecycle must be remotely accessible.**
  The authenticated API must expose list/create/remove operations for worktrees, and the `termcanvas` CLI must map to those routes.

- **C3. Hydra may not require manual canvas pre-registration.**
  Starting a workflow or direct worker in headless mode must ensure the repo/worktree is present in TermCanvas state automatically. Requiring the operator to run `termcanvas project add` first is not acceptable.

- **C4. Server-side workflow control must target the active headless server reliably.**
  Any in-process or server-triggered Hydra operation must force internal `termcanvas` calls to resolve to the current server instance instead of depending on external bind-host assumptions.

- **C5. Round 3 observability/security behavior must remain intact.**
  New routes stay behind auth, `/health*` stays publicly readable, `/api/status` remains sanitized, and no new route may expose tokens, webhook secrets, provider keys, PTY internals, or raw terminal output outside terminal-scoped telemetry/SSE paths.

- **C6. Existing Hydra file-contract behavior remains authoritative.**
  The new control plane may call into Hydra helpers, but workflow state must still be driven by validated `result.json` + `done` artifacts and existing workflow-store semantics.

- **C7. Verification must cover the new integration seams.**
  Final evidence for Round 4 must include targeted tests for workflow/worktree API behavior and the auto-registration/integration path, plus `npm run typecheck:headless` and `npm run build:headless`.

- **C8. Unrelated baseline failures remain untouched.**
  If broader repository tests still fail in unrelated areas, they should be documented rather than patched as part of Round 4.

## Implementation Plan

1. **Add shared headless workflow/worktree control helpers.**
   Solve P1, P2, P4, P6 under C1, C2, C4, C5, C6 by introducing server-side helpers that wrap Hydra workflow functions and git worktree operations with explicit request validation and sanitized response shapes.

2. **Expose workflow and worktree routes in the API server.**
   Solve P1, P2, P6 under C1, C2, C5, C6 by extending `headless-runtime/api-server.ts` with authenticated routes for workflow run/list/status/tick/retry/cleanup and worktree list/create/remove.

3. **Extend the `termcanvas` CLI for remote workflow/worktree control.**
   Solve P1, P2 under C1, C2, C5 by adding `workflow` and `worktree` command groups in `cli/termcanvas.ts`, including a client-side `workflow watch` loop built on the new API surface.

4. **Remove the manual canvas-state precondition from Hydra.**
   Solve P3 under C3, C6 by teaching Hydra's TermCanvas integration to add/rescan the repo automatically when a workflow or spawn run needs a repo/worktree that is not yet tracked.

5. **Stabilize internal TermCanvas endpoint resolution for server-side Hydra calls.**
   Solve P4 under C4, C5, C6 by ensuring the headless runtime publishes a loopback `TERMCANVAS_URL` or equivalent internal connection target before in-process workflow control is used.

6. **Add focused regression coverage and verify the headless surface.**
   Solve P5, P6 under C5, C7, C8 by adding tests for the new API/CLI behavior and the auto-registration path, then running headless typecheck/build plus the targeted test set.

## Regression Risks

- **Route/auth regression risk.**
  Expanding the API surface can accidentally bypass auth checks or leak sensitive workflow state.
  **Mitigation:** keep all new routes inside the existing authenticated branch and add explicit tests for unauthorized access.

- **Recursive/self-targeting workflow-control risk.**
  Server-triggered Hydra runs can fail if internal `termcanvas` calls point at `0.0.0.0`, an external URL, or a stale port file.
  **Mitigation:** set a loopback server URL after binding and cover it with integration tests.

- **Canvas-state drift risk.**
  Auto-adding/rescanning repos can duplicate project records or miss worktree updates.
  **Mitigation:** centralize the ensure/sync logic and test both “project missing” and “project already tracked” paths.
