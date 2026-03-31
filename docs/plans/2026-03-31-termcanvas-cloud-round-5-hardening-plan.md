# Round 5: TermCanvas Cloud Hardening Implementation Plan

> **Execution note:** Use `executing-plans` to implement this plan task-by-task, or another equivalent execution workflow supported by the current agent runtime.

**Goal:** Harden the headless cloud runtime for container deployment, make shutdown behavior reliable under Docker, and add deployment documentation that explains how to operate the remote workflow/worktree control plane safely.

**Architecture:** Keep the existing Round 3 and Round 4 API/control surfaces intact, but tighten the deployment boundary around them. Use container-level hardening for the image and compose stack, separate host-path configuration from in-container runtime paths, and refactor shutdown/persistence logic into an explicitly testable lifecycle helper so Docker stop behavior is verified instead of assumed.

**Tech Stack:** TypeScript, Node.js 22, Docker multi-stage builds, docker-compose, Hydra workflow control, TermCanvas headless runtime tests via `tsx --test`

---

## Problems Found

- **P1. The container still runs with an unnecessarily privileged runtime profile.**
  `server/Dockerfile` uses `node:22-slim` as the final image, installs `build-essential` and `python3` directly into the runtime stage, and runs the headless server as root. That makes the shipped image broader than necessary and keeps the persistent TermCanvas state under `/root/.termcanvas`.

- **P2. The compose/env contract currently points the runtime at the wrong workspace path.**
  `server/docker-compose.yaml` mounts the host workspace into `/workspace`, but `server/.env.example` sets `WORKSPACE_DIR=./_workspace` and the compose file passes that value through unchanged. Inside the container, the runtime therefore sees a relative `./_workspace` workspace root instead of the mounted `/workspace`, which can skew disk usage, workflow discovery, and operator expectations.

- **P3. Shutdown is best-effort and can drop the last state mutation.**
  `headless-runtime/index.ts` uses a debounced persistence callback with no flush API, then handles `SIGTERM`/`SIGINT` by stopping services and calling `process.exit(0)` after PTY teardown. If the process receives a stop signal during the debounce window, pending state writes can be lost. Repeated signals also re-enter the same shutdown path.

- **P4. The current shutdown path is not independently testable.**
  The lifecycle logic in `headless-runtime/index.ts` is embedded in `main()`, so there is no focused test that proves final state flush, single-run shutdown, service stop ordering, or port-file cleanup under container-style stop behavior.

- **P5. Operators still lack a truthful deployment runbook for the headless control plane.**
  The repo has `server/Dockerfile`, `server/docker-compose.yaml`, and `server/.env.example`, but no operator-facing guide that explains API token usage, which paths are server-side paths, how persistent state and workspace volumes map into the container, how webhooks/result callbacks behave, or how remote `termcanvas workflow` / `termcanvas worktree` commands should connect.

## Constraints

- **C1. Runtime hardening must preserve current headless capabilities while reducing privilege.**
  The final image must run the headless runtime as a non-root user, keep persistent state under that user’s home directory, and avoid shipping build toolchain packages in the final runtime layer.

- **C2. Compose and env defaults must describe the real container filesystem.**
  The documented workspace root used by the runtime must match the path actually mounted into the container, and host-path configuration must stay distinct from in-container repo/worktree paths.

- **C3. Docker stop must flush pending state exactly once before exit.**
  Graceful shutdown must be idempotent, must flush any pending persisted state before teardown completes, must remove the port file on success, and must not rely on silent retries or swallowed failures to appear healthy.

- **C4. Round 3 and Round 4 contracts must remain unchanged.**
  `/health*`, `/api/status`, webhook behavior, authenticated API routes, workflow/worktree control, and Hydra file-contract semantics must continue to work without behavioral regressions.

- **C5. New lifecycle hardening must be covered by focused automated tests.**
  Add targeted tests that verify the new persistence/shutdown behavior directly instead of relying only on end-to-end inference.

- **C6. Deployment documentation must be operationally accurate.**
  The new docs must explain required and optional env vars, volume mappings, remote CLI connection variables, webhook/result callback usage, and the fact that repo/worktree paths passed to the remote CLI must be paths visible on the server/container.

- **C7. Final evidence must include the full verification baseline.**
  Round 5 is not complete without the new targeted tests plus `npm test`, `npm run typecheck:headless`, and `npm run build:headless`.

## Implementation Plan

1. **Separate runtime hardening from build-time dependencies.**
   Solve P1 under C1 and C4 by converting `server/Dockerfile` to a multi-stage layout that builds production dependencies in a toolchain stage, keeps the final runtime image slim, adds a minimal init process for signal forwarding, and runs the server as an unprivileged user with a stable home/state directory.

2. **Fix the compose/env path contract and tighten deployment defaults.**
   Solve P1 and P2 under C1, C2, C4, and C6 by updating `server/docker-compose.yaml`, `server/.env.example`, and `.dockerignore` so the workspace mount, runtime `WORKSPACE_DIR`, state volume location, and build context all match the intended cloud deployment model.

3. **Refactor lifecycle management into a testable shutdown/persistence helper.**
   Solve P3 and P4 under C3, C4, and C5 by extracting the debounced persistence logic and shutdown orchestration from `headless-runtime/index.ts` into a small helper module with explicit `schedule`, `flush`, and idempotent shutdown behavior that the entrypoint can call.

4. **Add targeted lifecycle regression coverage.**
   Solve P3 and P4 under C3, C5, and C7 by adding focused tests for pending-state flushes and single-run graceful shutdown semantics, then wire the new test file into the repo’s test script.

5. **Write the operator runbook for docker-compose deployment.**
   Solve P5 under C2 and C6 by adding a deployment guide that covers API auth, volumes, health endpoints, webhook/result callback configuration, remote CLI usage, and server-side path expectations for workflow/worktree control.

6. **Run the full Round 5 verification baseline and record evidence.**
   Solve P1 through P5 under C4, C5, and C7 by running the new targeted lifecycle tests, `npm test`, `npm run typecheck:headless`, and `npm run build:headless`, then capture those commands in the implementer handoff.

## Regression Risks

- **Runtime path regression risk.**
  Changing the compose/env contract can break existing operator assumptions if host and container paths are blurred.
  **Mitigation:** keep host mount configuration in a separate variable, document server-visible paths explicitly, and preserve `/workspace` as the canonical in-container root.

- **Shutdown ordering regression risk.**
  Refactoring lifecycle code can accidentally stop services twice or exit before cleanup finishes.
  **Mitigation:** centralize shutdown state in one helper, make the shutdown promise idempotent, and add focused tests that assert single-run cleanup behavior.

- **Container compatibility regression risk.**
  Running as non-root can fail if writable directories are not prepared correctly.
  **Mitigation:** create/chown the home and workspace directories in the image, update the compose state mount to the non-root home, and verify the headless build/tests after the change.
