# Agent Runtime Internal Platform V1 Plan

## Goal

Build an internal remote agent runtime that TermCanvas can talk to over HTTP so many team members can submit remote coding tasks to a shared execution platform.

This version is optimized for:

- internal multi-user usage
- high task concurrency
- isolated remote execution
- auditable task history
- a clean upgrade path to larger scale

This is no longer a single-owner MVP.
It should be treated as an internal platform v1.

## Product Assumptions

We should design for these realities from day one:

- one user may start many Docker tasks in parallel
- the team may have on the order of 100 users
- multiple workers will be required
- artifacts and logs cannot live only on one machine's local disk
- authentication and authorization must work for more than one operator

That changes the architecture materially.
The previous single-tenant SQLite design is no longer the right default.

## Core Decision

Use this split:

- **Supabase handles identity**
  - GitHub OAuth if already used by the product
  - user session
  - JWT issuance
- **Our runtime handles execution**
  - task persistence
  - authorization checks
  - scheduling
  - worker coordination
  - remote execution
  - logs and artifacts
  - optional GitHub delivery

In short:

- Supabase answers: "who is this user?"
- the runtime answers: "may this task run, where should it run, and what happened?"

## Why This Version

For an internal platform used by a real team, we need to optimize for:

- correctness under concurrency
- operability
- isolation
- clear failure recovery
- a realistic path to worker pools

That means we should directly adopt a control-plane / worker-pool architecture.

## Product Boundary

### What V1 Is

- one logical runtime platform for many internal users
- one HTTP control plane
- multiple worker processes
- Docker-based task isolation
- task queueing and scheduling
- persisted task events
- persisted logs and artifacts
- optional GitHub delivery in a later phase

### What V1 Is Not

- public multi-tenant SaaS
- billing or quotas tied to pricing plans
- generalized workflow engine
- Kubernetes-native job platform on day one
- persistent per-task cloud desktops
- full durable execution replay

## Authentication And Authorization Model

The runtime should still **not** implement a separate login flow.

### Request Authentication

TermCanvas sends:

```http
Authorization: Bearer <supabase-access-token>
```

The runtime verifies the Supabase JWT using Supabase signing keys or JWKS.

### Authorization

V1 authorization should no longer be owner-only.
Instead, use an internal user model with explicit policy.

Minimum model:

- allow only users from an internal allowlist or internal organization mapping
- record the authenticated runtime user ID on every task
- enforce per-user and per-org concurrency limits
- restrict task submission to allowed repositories

Recommended runtime-side tables:

- `runtime_users`
- `runtime_user_roles`
- `runtime_repo_policies`

### Repository Access Boundary

The runtime should not pretend it can infer repository permissions from Supabase alone.

For V1:

- public repositories are allowed if policy permits
- private repositories require runtime-managed GitHub credentials
- repository eligibility should be checked against runtime policy before enqueue
- org/repo policy should live in the runtime control plane, not in the client

## GitHub Credential Model

Supabase auth proves **who is asking**.
It does **not** give the runtime the ability to clone private repos, push branches, or open pull requests.

For internal multi-user usage, a single long-lived personal token is a weak design.

Preferred V1 model:

- use a GitHub App for repository access and delivery
- mint installation tokens server-side per task or per delivery step
- scope permissions to the orgs/repos actually needed

Temporary fallback if GitHub App is not ready:

- use a server-side token with tightly scoped permissions
- do not rely on a developer's local `gh auth login` state
- do not forward the desktop client's GitHub session to the runtime

If we use the `gh` CLI for delivery later:

- pass a server-side token as `GH_TOKEN`
- treat `gh` as a client tool, not as the source of truth for credentials

## Runtime Architecture

### Recommended Stack

- Go control plane
- Postgres for task metadata and task events
- Redis for queueing, wake-up, cancel signaling, and fast coordination
- object storage for logs and artifacts
- worker pool for task execution
- Docker executor for isolation
- HTTP + SSE for the client-facing API

### Service Shape

Use a split architecture:

- **API service**
  - auth middleware
  - task create/list/get/cancel endpoints
  - admin and policy endpoints later
  - SSE event streaming
- **scheduler**
  - admission control
  - queue placement
  - concurrency enforcement
  - retries and backoff
- **worker service**
  - claims runnable tasks
  - prepares workspace
  - runs Docker executor
  - writes events, logs, and artifacts
- **artifact service layer**
  - writes logs, summaries, patches, and manifests to object storage

For V1, the scheduler can live in the API service process if needed.
The important separation is between the control plane and the workers.

### Architecture Principles From Existing Systems

Borrow from OpenAI Codex cloud:

- background task execution
- environment setup separated from agent execution
- restricted network access during the agent phase
- GitHub integration as a separate capability layer

Borrow from durable workflow systems such as LangGraph and Temporal:

- explicit task state transitions
- append-only execution history
- idempotent external side effects where possible
- worker coordination that can survive crashes and retries

Borrow from Manus:

- treat the filesystem as the agent's working memory during execution
- preserve work logs and failure traces
- keep execution sandboxes isolated from the control plane

Do not copy from Manus for V1:

- persistent per-task cloud computers
- sleep/wake sandbox lifecycle
- long-lived interactive sandbox state as product semantics

This platform should be Codex-like in task shape, not Manus-like in sandbox persistence.

## Storage Model

### Why Postgres

Postgres is the right default here because the runtime is a control-plane system:

- task state machine
- task events
- worker leases and heartbeats
- queue metadata
- artifact metadata
- policy tables

It is a better fit than SQLite at this concurrency level, and a more natural fit than MySQL when task events and semi-structured execution metadata matter.

### Why Redis

Redis should be used as an operational coordination layer, not as the source of truth.

Use it for:

- task dispatch and wake-up
- delayed retries
- cancellation signaling
- rate limiting and quotas
- fast worker coordination

Do not use Redis as the only durable task record.
Postgres remains the source of truth.

### Why Object Storage

With multiple workers and many users, local disk is not enough for durable artifact access.

Use object storage for:

- raw logs
- result summaries
- patches and diffs
- manifests
- future screenshots or other binary artifacts

## Data Model

### Task Status

- `queued`
- `assigned`
- `preparing`
- `running`
- `cancel_requested`
- `succeeded`
- `failed`
- `canceled`

### Core Tables

#### `tasks`

Suggested fields:

- `id`
- `created_by_user_id`
- `repo_url`
- `repo_ref`
- `prompt`
- `status`
- `priority`
- `queue_name`
- `worker_id`
- `lease_expires_at`
- `result_summary`
- `artifact_manifest_url`
- `failure_code`
- `failure_message`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`

#### `task_events`

Append-only history for each task.

Suggested fields:

- `id`
- `task_id`
- `seq`
- `type`
- `payload_json`
- `created_at`

#### `worker_heartbeats`

Suggested fields:

- `worker_id`
- `host`
- `capacity_json`
- `active_task_count`
- `last_heartbeat_at`

#### `task_artifacts`

Suggested fields:

- `id`
- `task_id`
- `kind`
- `storage_url`
- `size_bytes`
- `metadata_json`
- `created_at`

### Task Event Types

Minimum V1 event types:

- `task.created`
- `task.queued`
- `task.assigned`
- `task.preparing`
- `task.running`
- `task.log`
- `task.progress`
- `task.artifact_written`
- `task.cancel_requested`
- `task.succeeded`
- `task.failed`
- `task.canceled`

### Why Persist Events

Persisted events are required even in v1:

- SSE becomes a projection of stored events
- the UI can reconnect and replay missed output
- debugging is simpler
- auditability improves
- future recovery logic has a durable execution trail

## Queueing And Scheduling

### Scheduling Model

Use this model:

- Postgres stores canonical task state
- Redis holds runnable queue data and coordination signals
- workers pull or are notified of runnable tasks
- task claim is finalized atomically against Postgres

This avoids making the queue the only truth while still reducing heavy database polling.

### Admission Control

The runtime should reject or delay tasks before execution when limits are exceeded.

At minimum enforce:

- per-user running task limit
- per-user queued task limit
- per-repo running task limit
- per-worker container limit
- global platform concurrency limit

### Worker Lease Model

Workers must behave as leased executors, not as best-effort loops.

Rules:

- claiming a task must be atomic
- an active task always has a worker ID and lease expiration
- workers heartbeat while preparing or running
- lease loss triggers recovery logic

### Retry Model

V1 should support only limited retry behavior.

Retryable examples:

- transient repo fetch failure
- transient registry or network failure during setup
- temporary worker loss before the agent phase starts

Do not automatically retry forever.
Do not retry in a way that duplicates GitHub delivery side effects.

## Execution Model

### Worker Responsibilities

Each worker should:

- claim a runnable task
- create an isolated workspace
- obtain runtime-scoped credentials
- prepare the repo and environment
- start the Docker executor
- stream logs and events
- upload artifacts
- mark terminal state

### Docker Executor

Responsibilities:

- create isolated workspace directory
- obtain repo contents using runtime-managed GitHub credentials
- checkout target ref
- run setup phase
- run agent phase
- capture stdout and stderr
- collect patches and artifacts
- clean up task-scoped credentials

Do not run untrusted task execution directly on the host.

### Two-Phase Execution Policy

For V1, prefer:

- setup phase: network allowed for dependency installation and repo bootstrap
- agent phase: network disabled by default, with opt-in allowlists later

This is the correct default security posture for an internal coding agent runtime.

### Secret Exposure Policy

The runtime should distinguish between:

- task metadata safe for the full agent phase
- repo access credentials needed only briefly
- delivery credentials needed only for push/PR creation

Default rules:

- do not blindly pass all host secrets into the agent container
- expose high-sensitivity credentials only to the shortest phase that needs them
- remove write-capable GitHub credentials before the main agent loop unless delivery is part of the task

### Workspace Lifecycle

Each task gets its own workspace:

- `WORKSPACE_ROOT/<task_id>`

Rules:

- workspaces are created during `preparing`
- workspaces are mounted for only that task
- workspaces are not product-level persistent sandboxes
- terminal task completion does not depend on preserving the full workspace forever

If repo caching is added:

- `REPO_CACHE_ROOT/<repo-hash>` for shared fetch cache
- `WORKSPACE_ROOT/<task_id>` for isolated task state

## API Surface

### Required Endpoints

- `GET /healthz`
- `GET /readyz`
- `POST /api/tasks`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/cancel`
- `GET /api/tasks/:id/events`

### Likely Near-Term Endpoints

- `GET /api/queues`
- `GET /api/workers`
- `GET /api/repos/policies`
- `POST /api/admin/tasks/:id/retry`

### Transport

- regular HTTP for create/list/detail/cancel/admin
- SSE for task status and log streaming

Polling can exist as fallback, but SSE should be the primary UX.

## Artifact Model

Per-task artifact set:

- raw combined log
- result summary
- patch or diff if produced
- metadata manifest
- optional structured executor result

Manifest example:

```json
{
  "task_id": "task_123",
  "summary_url": "s3://bucket/tasks/task_123/summary.md",
  "log_url": "s3://bucket/tasks/task_123/run.log",
  "patch_url": "s3://bucket/tasks/task_123/changes.patch",
  "created_at": "2026-03-24T12:00:00Z"
}
```

### Observability

Every task should leave behind enough evidence to answer:

- who submitted it
- what repo and ref were used
- what worker ran it
- what commands ran
- what it changed
- why it failed or succeeded

Minimum observable outputs:

- persisted task row
- persisted task events
- worker heartbeat trail
- raw log
- artifact manifest

## GitHub Delivery

This should still be a later phase, not a prerequisite for platform v1 execution.

Phase 1:

- complete task
- persist artifacts
- let users inspect outputs manually

Phase 2:

- push result branch
- optionally create PR

When phase 2 is added:

- prefer GitHub App installation tokens
- keep delivery as a separate execution step with explicit idempotency keys
- do not allow retries to create duplicate PRs

## Failure Handling

The runtime must explicitly handle:

- invalid Supabase token
- authenticated but unauthorized user
- repo policy rejection
- queue publish failure
- task claim race
- worker crash
- lease expiration
- repo fetch failure
- Docker launch failure
- container exit non-zero
- object storage upload failure
- cancel requested while task is running

### Recovery Rules

Basic rule:

- tasks must never silently disappear

Suggested restart repair:

- `queued` stays `queued`
- `assigned` with expired lease returns to `queued`
- `preparing` with expired lease returns to `queued` or `failed` based on failure evidence
- `running` with expired lease becomes `failed` unless resumable execution exists later
- `cancel_requested` becomes `canceled` if the worker confirms stop, otherwise remains recoverable until lease expiry

Keep recovery deterministic.
Do not rely on operator guesswork.

### Cancel Semantics

- if task is still `queued`, cancel immediately and mark `canceled`
- if task is `assigned`, `preparing`, or `running`, mark `cancel_requested`
- worker should stop the container and then mark terminal `canceled`
- if the worker dies mid-cancel, lease recovery must resolve the final state

## Durability Boundary

This platform is **not** a full durable execution engine.

It does not guarantee:

- replay from an exact interpreter frame
- checkpointing every model step
- resuming a partially completed container after crash

It does guarantee:

- durable task submission
- durable task state transitions
- durable task event history
- durable terminal result records
- deterministic recovery for lost workers and expired leases

That is the correct boundary for v1.

## Operations

### Runtime Config

Example:

```env
RUNTIME_PORT=8080
SUPABASE_URL=...
SUPABASE_JWKS_URL=...
POSTGRES_DSN=postgres://...
REDIS_URL=redis://...
ARTIFACT_BUCKET=termcanvas-runtime
WORKSPACE_ROOT=/var/lib/termcanvas-runtime/workspaces
REPO_CACHE_ROOT=/var/lib/termcanvas-runtime/repo-cache
DOCKER_IMAGE=...
GITHUB_APP_ID=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_APP_PRIVATE_KEY_PATH=...
```

### Deployment Shape

For v1:

- API service as one deployment group
- worker service as a separate deployment group
- Postgres as managed or company-standard service
- Redis as managed or company-standard service
- object storage as managed or company-standard service

Do not start with:

- many microservices with unclear ownership
- a Kubernetes-native controller/operator design
- multiple queue technologies at once

## Security Posture

### Defaults

- task execution is isolated in Docker
- agent network is denied by default after setup
- credentials are short-lived and phase-scoped
- logs and artifacts are auditable
- every task is attributable to a user identity

### Near-Term Hardening

- outbound domain allowlists for enabled network access
- image allowlist for executor containers
- CPU, memory, and disk quotas per task
- secret redaction in logs
- policy checks on allowed repo orgs and refs

## Implementation Phases

### Phase 1: Control Plane Bootstrap

- Go API service
- config loading
- `healthz` and `readyz`
- Supabase JWT verification middleware
- runtime user allowlist or org mapping
- Postgres schema bootstrap

### Phase 2: Task Persistence And Events

- `tasks` table
- `task_events` table
- create/list/get/cancel APIs
- SSE from persisted events

### Phase 3: Redis Queue And Worker Pool

- Redis queue publish/consume
- worker registration
- task claiming with Postgres lease fields
- worker heartbeats

### Phase 4: Docker Executor

- workspace preparation
- repo checkout via runtime-managed GitHub credentials
- setup phase
- agent phase
- log capture
- terminal state transitions

### Phase 5: Artifacts And Observability

- object storage upload
- task manifests
- worker metrics
- admin inspection surfaces

### Phase 6: Policy And Scheduling

- per-user concurrency limits
- per-worker capacity enforcement
- per-repo policy checks
- retry and backoff rules

### Phase 7: Optional GitHub Delivery

- push branch
- optional PR creation
- idempotent delivery records

## Explicit Non-Goals For V1

- public SaaS multi-tenancy
- billing system
- generalized workflow DAG engine
- persistent VM per task
- exact execution replay
- Kubernetes-first scheduling
- Kafka plus Redis plus another MQ all at once

## Upgrade Path

This design leaves room to evolve:

- single queue -> multiple priority queues
- simple scheduler -> fairness-aware scheduler
- Docker on VMs -> Kubernetes job execution later
- basic policy tables -> richer org/repo RBAC
- simple retries -> structured workflow retries
- manual artifact review -> GitHub-native delivery

The important point is to make the control-plane contracts correct now:

- Postgres remains source of truth
- Redis remains an operational coordination layer
- workers remain leased executors
- task events remain append-only
