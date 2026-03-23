# Agent Runtime MVP Implementation Plan

> **Execution note:** Use `executing-plans` to implement this plan task-by-task, or another equivalent execution workflow supported by the current agent runtime.

**Goal:** Add a small self-hosted agent runtime so TermCanvas can submit remote agent tasks to a server that creates isolated Docker workspaces, executes tasks, streams status/logs, and returns delivery artifacts.

**Architecture:** Keep TermCanvas as the local control plane and add a new Go service as the runtime. The runtime owns task persistence, task state transitions, Docker execution, artifact metadata, and delivery hooks. The first version is single-server and single-runtime, with optional polling first and SSE as the preferred status stream.

**Tech Stack:** Go, MySQL, Redis, Docker, GitHub API, HTTP + SSE, existing Electron/TypeScript TermCanvas frontend

---

### Task 1: Define runtime boundaries and repo layout

**Files:**
- Create: `server/go.mod`
- Create: `server/cmd/runtime/main.go`
- Create: `server/internal/config/config.go`
- Create: `server/internal/http/router.go`
- Create: `server/internal/domain/task.go`
- Create: `server/README.md`
- Modify: `README.md`

**Step 1: Write the failing smoke test for server bootstrap**

- Add a small HTTP server bootstrap test under `server/internal/http/router_test.go`.
- Assert that `GET /healthz` returns `200` and JSON body `{ "ok": true }`.

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./...`
Expected: FAIL because runtime files and routes do not exist yet.

**Step 3: Write minimal runtime bootstrap**

- Create `main.go` with config loading and server startup.
- Create router with:
  - `GET /healthz`
  - `GET /readyz`
- Define the initial domain types:
  - `TaskStatus`: `queued`, `preparing`, `running`, `succeeded`, `failed`, `canceled`
  - `DeliveryStatus`: `pending`, `branch_pushed`, `pr_opened`, `skipped`, `failed`

**Step 4: Run tests to verify bootstrap passes**

Run: `cd server && go test ./...`
Expected: PASS for bootstrap tests.

**Step 5: Commit**

```bash
git add server/go.mod server/cmd/runtime/main.go server/internal/config/config.go server/internal/http/router.go server/internal/domain/task.go server/README.md README.md
git commit -m "feat: add agent runtime bootstrap"
```

### Task 2: Add persistent task model and state machine

**Files:**
- Create: `server/internal/store/mysql/task_store.go`
- Create: `server/internal/store/mysql/migrations/0001_tasks.sql`
- Create: `server/internal/service/task_service.go`
- Create: `server/internal/service/task_service_test.go`
- Create: `server/internal/domain/task_state_machine.go`
- Create: `server/internal/domain/task_state_machine_test.go`

**Step 1: Write failing tests for task creation and legal state transitions**

- Assert valid transitions:
  - `queued -> preparing -> running -> succeeded`
  - `queued -> preparing -> failed`
  - `running -> canceled`
- Assert invalid transitions are rejected:
  - `succeeded -> running`
  - `failed -> preparing`

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/domain ./internal/service`
Expected: FAIL because state machine and store do not exist.

**Step 3: Write minimal implementation**

- Add MySQL `tasks` table with:
  - `id`
  - `repo_url`
  - `repo_ref`
  - `task_prompt`
  - `status`
  - `delivery_status`
  - `worker_id`
  - `workspace_path`
  - `result_summary`
  - `created_at`, `updated_at`, `started_at`, `finished_at`
- Add service methods:
  - `CreateTask`
  - `GetTask`
  - `ListTasks`
  - `TransitionTask`

**Step 4: Run tests**

Run: `cd server && go test ./...`
Expected: PASS for domain and service tests.

**Step 5: Commit**

```bash
git add server/internal/store/mysql server/internal/service server/internal/domain
git commit -m "feat: add runtime task model and state machine"
```

### Task 3: Add queueing and single-node worker execution

**Files:**
- Create: `server/internal/queue/redis_queue.go`
- Create: `server/internal/worker/runner.go`
- Create: `server/internal/worker/runner_test.go`
- Create: `server/internal/executor/docker_executor.go`
- Create: `server/internal/executor/docker_executor_test.go`
- Create: `server/internal/executor/templates/entrypoint.sh`

**Step 1: Write failing tests for enqueue/dequeue and worker lifecycle**

- Assert task creation enqueues a task ID.
- Assert worker picks one queued task and marks it `preparing`, then `running`.
- Assert worker writes back terminal logs and final status.

**Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/queue ./internal/worker ./internal/executor`
Expected: FAIL because queue and executor do not exist.

**Step 3: Write minimal implementation**

- Use Redis list or stream for the first task queue.
- Add one process-local worker loop.
- Docker executor responsibilities:
  - create workspace directory
  - clone repository or fetch into cache and checkout ref
  - start container with mounted workspace
  - inject prompt/task metadata
  - capture stdout/stderr
- First version can store logs in files plus DB metadata instead of full log indexing.

**Step 4: Run tests**

Run: `cd server && go test ./...`
Expected: PASS for queue and worker unit tests.

**Step 5: Commit**

```bash
git add server/internal/queue server/internal/worker server/internal/executor
git commit -m "feat: add single-node task queue and docker worker"
```

### Task 4: Expose task APIs for TermCanvas integration

**Files:**
- Create: `server/internal/http/task_handler.go`
- Create: `server/internal/http/task_handler_test.go`
- Modify: `server/internal/http/router.go`
- Create: `src/runtime/api.ts`
- Create: `src/stores/runtimeTaskStore.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`

**Step 1: Write failing tests for task APIs**

- `POST /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/events` via SSE

**Step 2: Run tests to verify they fail**

Run: `cd server && go test ./internal/http`
Expected: FAIL because handlers do not exist.

**Step 3: Write minimal implementation**

- Add server DTOs:
  - create task request
  - task detail response
  - task event payload
- Add renderer-side API wrapper in `src/runtime/api.ts`.
- Add Zustand store for runtime tasks.
- Add preload bridge entries for runtime host config if TermCanvas should proxy requests through Electron.

**Step 4: Add UI integration placeholder**

- Add a minimal non-invasive surface:
  - one "Remote task" entry in the composer or context menu
  - one task list panel or card group showing status, last update, and artifact links
- Do not redesign the whole canvas in MVP.

**Step 5: Run tests**

Run: `cd server && go test ./...`
Expected: PASS for API tests.

**Step 6: Commit**

```bash
git add server/internal/http src/runtime src/stores/runtimeTaskStore.ts electron/preload.ts src/types/index.ts
git commit -m "feat: expose runtime task APIs to TermCanvas"
```

### Task 5: Add artifact capture and delivery to GitHub

**Files:**
- Create: `server/internal/artifact/store.go`
- Create: `server/internal/artifact/store_test.go`
- Create: `server/internal/delivery/github_client.go`
- Create: `server/internal/delivery/github_client_test.go`
- Create: `server/internal/service/delivery_service.go`
- Modify: `server/internal/executor/docker_executor.go`

**Step 1: Write failing tests for result artifact creation**

- Assert task completion writes:
  - result summary
  - diff or patch path
  - log file path
  - branch name
- Assert GitHub delivery can:
  - push branch
  - optionally create PR

**Step 2: Run tests to verify failure**

Run: `cd server && go test ./internal/artifact ./internal/delivery ./internal/service`
Expected: FAIL because artifact and delivery services do not exist.

**Step 3: Write minimal implementation**

- Persist artifact metadata in DB or JSON manifest.
- Delivery flow:
  - create branch name from task ID
  - push branch with token/App credentials
  - create draft PR if requested
- First version can support GitHub only.

**Step 4: Run tests**

Run: `cd server && go test ./...`
Expected: PASS for artifact and delivery tests.

**Step 5: Commit**

```bash
git add server/internal/artifact server/internal/delivery server/internal/service
git commit -m "feat: add task artifact capture and github delivery"
```

### Task 6: Stabilize operations, observability, and local development flow

**Files:**
- Create: `server/docker-compose.yml`
- Create: `server/.env.example`
- Create: `server/internal/telemetry/logger.go`
- Create: `server/internal/telemetry/metrics.go`
- Create: `server/internal/http/middleware.go`
- Create: `server/scripts/dev-up.sh`
- Create: `server/scripts/dev-down.sh`
- Modify: `server/README.md`
- Modify: `README.md`

**Step 1: Write failing tests for middleware and failure handling**

- Assert request IDs are attached.
- Assert structured errors are returned consistently.
- Assert worker heartbeat timeout flips stale tasks to `failed` or `queued_for_retry`.

**Step 2: Run tests to verify failure**

Run: `cd server && go test ./internal/http ./internal/worker`
Expected: FAIL because middleware and heartbeat handling do not exist.

**Step 3: Write minimal implementation**

- Add request ID middleware and structured logs.
- Add metrics:
  - task counts by status
  - task duration histogram
  - queue depth gauge
  - worker heartbeat age
- Add local dev stack:
  - MySQL
  - Redis
  - runtime
- Document required secrets:
  - GitHub token/App
  - runtime auth token
  - Docker socket access

**Step 4: Run verification**

Run:
- `cd server && go test ./...`
- `cd server && docker compose up -d`
- `curl http://localhost:<runtime-port>/healthz`

Expected:
- tests PASS
- services boot successfully
- `healthz` returns `200`

**Step 5: Commit**

```bash
git add server/docker-compose.yml server/.env.example server/internal/telemetry server/internal/http/middleware.go server/scripts server/README.md README.md
git commit -m "chore: add runtime operations and local dev flow"
```

### Phase priorities

**Phase 1: Must ship for MVP**
- Task 1
- Task 2
- Task 3
- Task 4

**Phase 2: Makes it genuinely useful**
- Task 5

**Phase 3: Makes it interview-grade**
- Task 6

### Explicitly out of scope for MVP

- Multi-node scheduling
- Kubernetes
- Multi-tenant authz
- Full sandbox hardening beyond Docker isolation
- Rich UI redesign
- Multi-provider delivery beyond GitHub
- Auto-scaling workers

### Notes for later refinement

- If you want maximum JD alignment, prefer Go as the runtime language.
- If you want fastest delivery, you can replace Redis with in-process queue for the very first spike, but keep the queue interface so Redis can be swapped in immediately after.
- If you want strongest demo value, prioritize one end-to-end flow:
  - submit task from TermCanvas
  - run task in Docker
  - stream logs/status
  - push branch
  - create PR
