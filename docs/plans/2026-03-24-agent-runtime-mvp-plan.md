# Agent Runtime MVP Plan

## Goal

Build a small self-hosted agent runtime that TermCanvas can talk to over HTTP so remote agent tasks can run on a dedicated Linux server.

This MVP is explicitly:

- single-tenant
- owner-operated
- self-hosted
- runtime service owned by us, not by Supabase

At the same time, it should **reuse the existing Supabase auth system** so we do not build a second login stack.

## Core Decision

Use this split:

- **Supabase handles identity**
  - GitHub OAuth
  - user session
  - JWT issuance
- **Our runtime handles execution**
  - task persistence
  - task state transitions
  - remote execution
  - artifact capture
  - optional GitHub delivery

In short:

- Supabase answers: "who is this user?"
- The runtime answers: "what remote task should run, where, and with what result?"

## Why This Version

The previous version of this document was too heavy for a first release. It front-loaded:

- MySQL
- Redis
- multi-stage queueing
- GitHub delivery
- broader platform concerns

That is too much for a first usable version.

The first version should optimize for one thing:

**reliably submit and execute remote agent tasks on one server for one owner user**

If that loop is not solid, the rest is noise.

## Product Boundary

### What MVP Is

- One runtime server on a long-lived Linux host
- One owner user
- One TermCanvas client talking to it
- One remote worker process in the runtime
- Docker-based workspace isolation
- Simple task API
- Logs and result artifacts

### What MVP Is Not

- multi-tenant SaaS
- team-wide permission system
- billing or quotas
- complex orchestration engine
- autoscaling worker fleet
- Redis-backed distributed queue
- MySQL-backed operational platform

## Authentication Model

The runtime should **not** implement a separate login flow.

### Request Authentication

TermCanvas sends:

```http
Authorization: Bearer <supabase-access-token>
```

The runtime verifies the Supabase JWT using Supabase signing keys or JWKS.

### Authorization

MVP authorization is intentionally simple:

- allow exactly one configured owner user ID
- reject all other valid users
- only accept tasks for repositories that this authenticated owner user already has permission to access

Config example:

```env
SUPABASE_URL=...
SUPABASE_JWKS_URL=...
RUNTIME_OWNER_USER_ID=...
```

This keeps auth reusable without pretending the service is already team-ready.

### Repository Access Boundary

The runtime does **not** manage repository permissions.

For MVP:

- the authenticated owner user may submit tasks only for repos they already have access to
- public repos are fine
- private repos are fine only if the owner's existing GitHub credentials already allow clone/fetch
- the runtime does not implement org/repo RBAC
- the runtime does not broker or discover repository permissions on behalf of the user

In short:

- we are not building private-repo management
- we are only executing against repos the logged-in owner account can already access

## Runtime Architecture

### Recommended Stack

- Go runtime service
- SQLite for task metadata
- local filesystem for artifacts and logs
- in-process worker loop
- Docker executor
- HTTP + SSE

### Why Not MySQL and Redis First

For a single-server owner-operated service:

- SQLite is enough
- one in-process queue is enough
- fewer moving parts means faster iteration and fewer failure modes

We should only add MySQL or Redis after a real operational reason appears.

## Repo Layout

```text
server/
  cmd/runtime/
  internal/config/
  internal/http/
  internal/domain/
  internal/store/sqlite/
  internal/worker/
  internal/executor/docker/
  internal/artifact/
  README.md
```

Renderer-side integration should stay light:

```text
src/runtime/api.ts
src/stores/runtimeTaskStore.ts
```

## Task Model

### Task Status

- `queued`
- `preparing`
- `running`
- `succeeded`
- `failed`
- `canceled`

### Task Fields

MVP task record:

- `id`
- `created_by_user_id`
- `repo_url`
- `repo_ref`
- `prompt`
- `status`
- `workspace_path`
- `result_summary`
- `artifact_manifest_path`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`

Repository eligibility rule:

- only accept repositories the authenticated owner user already has permission to access

No team model yet.
No org model yet.
No per-user quotas yet.

## Execution Model

### Worker

The runtime runs a single in-process worker loop:

- read next queued task from SQLite
- mark `preparing`
- prepare workspace
- run Docker executor
- stream logs
- write result
- mark terminal state

For MVP, serial execution is acceptable.

If needed later:

- add configurable concurrency
- then add a real queue

### Docker Executor

Responsibilities:

- create isolated workspace directory
- clone repo or fetch cached repo using the owner's existing repository credentials
- checkout target ref
- mount workspace into container
- inject task metadata
- run agent entrypoint
- capture stdout/stderr
- write artifacts

This is the right place for isolation.
Do not start with host-process execution.
Do not add repo-permission management here.

## API Surface

### Required Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/events`

### Transport

- regular HTTP for create/list/detail/cancel
- SSE for status and log stream

Polling is acceptable as a temporary fallback, but SSE should be the intended model.

## Artifact Model

Store artifacts on local disk first.

Per-task artifact set:

- raw log
- result summary
- patch or diff if produced
- metadata manifest

Manifest example:

```json
{
  "task_id": "task_123",
  "summary_path": "...",
  "log_path": "...",
  "patch_path": "...",
  "created_at": "..."
}
```

Do not start with object storage unless it becomes necessary.

## GitHub Delivery

This should be **phase 2**, not required for the first runnable MVP.

Phase 1:

- complete task
- persist artifacts
- let user inspect outputs manually

Phase 2:

- push result branch
- optionally create PR

Reason: task execution is the real system risk. Delivery can come later.

## TermCanvas Integration

Keep the UI integration intentionally small.

### MVP Renderer Changes

- runtime host config
- runtime auth/token usage via existing Supabase session
- one entry to submit a remote task
- one task list/status panel

Do not redesign the whole canvas around runtime tasks in version 1.

TermCanvas remains the local control plane, not the worker platform itself.

## Failure Handling

MVP should explicitly handle:

- invalid Supabase token
- authenticated but unauthorized user
- repo fetch failure
- Docker launch failure
- container exit non-zero
- runtime restart while tasks are mid-flight

Basic rule:

- tasks must never silently disappear
- after restart, tasks in `preparing` or `running` should become `failed` or `queued` via an explicit recovery rule

Keep recovery simple and deterministic.

## Operations

### Runtime Config

Example:

```env
RUNTIME_PORT=8080
SUPABASE_URL=...
SUPABASE_JWKS_URL=...
RUNTIME_OWNER_USER_ID=...
SQLITE_PATH=/var/lib/termcanvas-runtime/runtime.db
ARTIFACT_ROOT=/var/lib/termcanvas-runtime/artifacts
WORKSPACE_ROOT=/var/lib/termcanvas-runtime/workspaces
DOCKER_IMAGE=...
GITHUB_TOKEN=...
```

### Local Deployment Shape

For MVP:

- one systemd service or one Docker Compose deployment
- persistent disk for DB and artifacts
- reverse proxy optional

Do not build a "platform ops" layer yet.

## Implementation Phases

### Phase 1: Runtime Bootstrap

- Go service
- config loading
- `healthz` and `readyz`
- Supabase JWT verification middleware
- owner-only authorization

### Phase 2: Task Persistence

- SQLite schema
- task state model
- create/list/get/cancel APIs

### Phase 3: Worker and Docker Execution

- in-process worker loop
- Docker executor
- status transitions
- log capture

### Phase 4: SSE and Artifacts

- task event stream
- artifact manifest
- result summary and patch persistence

### Phase 5: TermCanvas Integration

- runtime API client
- task list store
- minimal UI entry point

### Phase 6: Optional GitHub Delivery

- push branch
- optional PR creation

## Explicit Non-Goals For MVP

- multi-user runtime access
- tenant isolation
- private repository permission management
- workspace pooling
- distributed workers
- Redis queue
- MySQL
- billing
- quota enforcement
- org/repo RBAC
- generalized plugin architecture

## Upgrade Path

This design intentionally leaves room to evolve:

- SQLite -> MySQL/Postgres
- in-process queue -> Redis / durable queue
- owner-only -> small internal team allowlist
- single worker -> multi-worker
- manual artifact review -> automated GitHub delivery

That path is possible without changing the core auth split:

- Supabase remains the identity provider
- runtime remains the execution service

## Recommendation

Build the runtime as:

- self-hosted
- single-tenant
- Supabase-authenticated
- owner-authorized
- SQLite-backed
- Docker-executed
- SSE-streamed

That is the smallest version that is both technically honest and strategically aligned with a later internal-service direction.
