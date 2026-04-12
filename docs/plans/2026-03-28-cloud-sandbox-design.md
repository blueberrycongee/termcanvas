# Cloud Sandbox Design

## Overview

Cloud-hosted task execution for termcanvas. Users submit tasks from the Electron client, tasks run in isolated Firecracker microVMs with Hydra orchestration, results are delivered as Git branches, file artifacts, or live sandbox takeover.

Business model: platform holds API keys, users pay for orchestrated Claude Code + Codex service.

## Architecture

```
termcanvas client (Electron)
       | WebSocket + REST
       v
API Gateway (Hono + Node.js)
       |
  +----+--------+
  v              v
Task Queue     Sandbox Manager
(BullMQ/Redis) (E2B self-hosted)
  |              |
  v              v
Postgres       Firecracker microVM pool
(Supabase)     +-----------------------------------+
               | Single task VM                     |
               |  Headless Runtime (pty + api + tel) |
               |  Hydra Orchestrator                |
               |  Claude Code / Codex CLI           |
               |  Git + toolchain                   |
               +-----------------------------------+
                      |
               Object Store (MinIO)
```

### Core components

| Component | Role | Tech |
|---|---|---|
| API Gateway | Auth, task CRUD, WebSocket relay, billing | Hono + Node.js |
| Sandbox Manager | VM lifecycle, image/snapshot mgmt, pool | Node.js + E2B self-hosted SDK |
| Headless Runtime | Headless TermCanvas (pty + API + telemetry) | Node.js, extracted from Electron |
| Hydra Orchestrator | Agent workflow inside VM | Existing Hydra (unchanged) |
| Object Store | Artifacts, logs | MinIO (S3-compatible) |
| Database | Task metadata, users, billing, keys | Supabase Postgres (existing) |
| Task Queue | Reliable task dispatch with retry/priority | BullMQ + Redis |
| Monitoring | VM metrics, task metrics | Prometheus + Grafana |

### Key design decisions

1. **Hydra + Headless Runtime run inside the VM** -- the VM is an autonomous unit; the cloud management layer only manages lifecycle, not orchestration.
2. **API Gateway is the only public entry point** -- VM cluster has no public IPs.
3. **Existing Supabase reused** -- auth + user data already there; add cloud_tasks table and billing.

## Headless Runtime

Extracted from Electron main process. The Electron coupling analysis:

| Module | Electron dependency | Action |
|---|---|---|
| `pty-manager.ts` | None (pure node-pty) | Reuse directly |
| `telemetry-service.ts` | None (pure Node.js fs/path) | Reuse directly |
| `api-server.ts` | `BrowserWindow.webContents.executeJavaScript()` | Rewrite: replace `execRenderer` with direct `ProjectStore` |

### Structure

```
headless-runtime/
  index.ts              -- entry point, starts all services
  pty-manager.ts        -- reuse from electron/pty-manager.ts
  telemetry-service.ts  -- reuse from electron/telemetry-service.ts
  api-server.ts         -- rewritten, no execRenderer, direct store access
  project-store.ts      -- new: replaces React/Zustand store, pure Node.js in-memory
  heartbeat.ts          -- new: reports VM status to API Gateway
  artifact-collector.ts -- new: collects and uploads deliverables
```

### Hydra compatibility

Hydra continues to call `termcanvas` CLI which hits the HTTP API. The API implementation changes from `Electron + React store` to `headless runtime + in-memory store`. Interface contract unchanged.

```
Before: Hydra -> termcanvas CLI -> HTTP -> api-server -> execRenderer -> React store -> pty-manager
After:  Hydra -> termcanvas CLI -> HTTP -> api-server -> project-store -> pty-manager
                                          (headless)    (new, pure Node.js)
```

## E2B Self-Hosted Infrastructure

### Cluster

- Bare metal servers with KVM support (Hetzner AX41-NVMe recommended)
- E2B orchestrator manages VM create/destroy/snapshot
- Pre-warmed VM pool for <200ms startup
- Per VM: 2-4 vCPU, 4-8 GB RAM
- Single server supports 8-16 concurrent VMs

### VM template

Built from Dockerfile, stored as Firecracker snapshot:

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    git curl wget build-essential \
    python3 python3-pip nodejs npm \
    && npm install -g n && n 20
RUN npm install -g @anthropic-ai/claude-code
RUN npm install -g @openai/codex
COPY dist-headless/ /opt/termcanvas/
COPY hydra/ /opt/termcanvas/hydra/
COPY dist-cli/termcanvas /usr/local/bin/termcanvas
COPY entrypoint.sh /entrypoint.sh
```

### VM lifecycle

```
Create (task submitted)
  -- restore from pre-warmed snapshot
  -- inject: API keys + git repo URL + task description
  v
Running (Hydra orchestrates)
  -- heartbeat every 10s
  -- user can stream logs or takeover terminal
  v
Completed (result.json + done)
  -- artifact-collector uploads to Object Store
  -- git push branch to user remote
  v
Cooldown (30min, user can takeover)
  v
Destroy
```

### Secret injection

API keys decrypted from Supabase Vault at VM creation, injected as env vars. Keys never written to disk inside VM. VM destruction eliminates all traces.

## API Gateway

### Endpoints

```
POST   /auth/login
POST   /auth/refresh

POST   /tasks                      -- create task
GET    /tasks                      -- list (paginated, filterable)
GET    /tasks/:id                  -- task detail + progress
DELETE /tasks/:id                  -- cancel (destroy VM)

GET    /tasks/:id/artifacts        -- list artifacts
GET    /tasks/:id/artifacts/:name  -- download artifact

WS     /tasks/:id/stream           -- realtime: progress + logs + telemetry
WS     /tasks/:id/terminal         -- sandbox takeover: bidirectional PTY
```

### Task data model

```sql
create table cloud_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  device_id   text,
  title       text not null,
  task        text not null,
  repo_url    text,
  branch      text default 'main',
  template    text default 'researcher-implementer-tester',
  agent_config jsonb default '{}',
  status      text default 'queued'
              check (status in ('queued','provisioning','running',
                                'completed','failed','cancelled')),
  sandbox_id  text,
  workflow_id text,
  result      jsonb,
  artifacts   jsonb default '[]',
  git_branch  text,
  pr_url      text,
  started_at  timestamptz,
  finished_at timestamptz,
  vm_seconds  int default 0,
  token_usage jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table cloud_tasks enable row level security;
create policy "users own tasks" on cloud_tasks for all using (auth.uid() = user_id);
```

### Task lifecycle

`queued` -> `provisioning` (create VM, clone repo) -> `running` (Hydra executes, heartbeat every 10s) -> `completed` / `failed` / `cancelled`

### Heartbeat protocol

VM posts to `POST /tasks/:id/heartbeat` every 10s with workflow status, current handoff, telemetry snapshot, resource usage. API Gateway updates DB, pushes to WebSocket subscribers. 60s without heartbeat triggers stall detection.

## Deliverables

Three artifact types produced in parallel on task completion:

1. **Git artifacts** -- commit + push `cloud/{taskId}` branch, optional auto-PR
2. **File artifacts** -- tar.gz uploaded to MinIO `/artifacts/{taskId}/`
3. **Sandbox retention** -- VM kept alive 30min for user takeover

### Sandbox takeover

Bidirectional WebSocket PTY relay:

```
Client xterm.js <--WS--> API Gateway <--WS--> VM headless runtime pty-manager
```

Headless runtime exposes `WS /pty/stream` endpoint. Reuses existing pty-manager, replacing Electron IPC with WebSocket transport.

## Security Model

### Layer 1: User auth
Supabase Auth (existing) + JWT validation at API Gateway.

### Layer 2: Secret management
- Phase 1: Platform holds unified API keys, meters per-user usage
- Phase 2: Users can bring own keys, encrypted in Supabase Vault (AES-256), decrypted only at VM creation

### Layer 3: VM isolation
Firecracker microVM with independent kernel. Hardware-level isolation between tasks and users.

### Layer 4: Network policy
VM egress whitelist: api.anthropic.com, api.openai.com, github.com, gitlab.com, registry.npmjs.org, pypi.org, API Gateway internal. All other egress blocked. No public IP on VMs; only API Gateway can reach them.

### Layer 5: Resource limits
- /opt/termcanvas read-only, /workspace writable
- API keys in env vars only, never on disk
- VM max lifetime: 2h hard timeout
- Per-user concurrent VM cap (e.g. 3)
- Firecracker cgroup CPU/memory quotas

### User code risks

| Risk | Mitigation |
|---|---|
| Read API key from env | VM isolation -- single-task ephemeral env, destroyed after |
| Exfiltrate data | Egress whitelist, only known domains allowed |
| Crypto mining / abuse | 2h hard timeout + CPU/memory cgroup quota |
| Lateral movement | VMs fully isolated, no shared storage/network |

## Client UI Changes

### New components

| Component | Function |
|---|---|
| `CloudPanel` | Task list, WebSocket status subscription |
| `TaskCard` | Task card: status, progress, action buttons |
| `TaskCreateDialog` | Submit task: repo, branch, description, template |
| `CloudTerminal` | Sandbox takeover terminal (reuse xterm.js, WebSocket to cloud) |
| `ArtifactViewer` | View/download artifacts, diff preview |

### New store

```typescript
// src/stores/cloudStore.ts
interface CloudStore {
  tasks: CloudTask[];
  activeStreams: Map<string, WebSocket>;
  createTask(opts: CreateTaskOpts): Promise<CloudTask>;
  cancelTask(taskId: string): Promise<void>;
  subscribeTask(taskId: string): void;
  takeoverTerminal(taskId: string): void;
}
```

Cloud Panel coexists with local Canvas. Local Hydra continues to work; cloud is additive.

## Implementation Phases

### Phase 0: Headless Runtime (foundation)
- Extract pty-manager, telemetry-service from Electron
- Write project-store to replace React store
- Rewrite api-server without execRenderer
- Validate: headless runtime starts in VM, Hydra completes a local task

### Phase 1: Single-node cloud MVP
- One Hetzner bare metal, deploy self-hosted E2B
- VM template: Ubuntu + Claude Code + Codex + headless runtime
- API Gateway (Hono) + cloud_tasks table
- Minimal flow: submit task -> create VM -> Hydra runs -> result in DB
- Validate: curl submit a task, get result.json back

### Phase 2: Client integration
- Cloud Panel UI (TaskCard, TaskCreateDialog)
- WebSocket realtime progress stream
- Artifact viewing/download
- Validate: submit task from termcanvas client, see progress, get result

### Phase 3: Sandbox takeover + artifact polish
- Terminal takeover (WebSocket PTY relay)
- artifact-collector + MinIO upload
- Git branch push + optional auto-PR
- Validate: takeover VM terminal after task, download artifacts, see PR

### Phase 4: Production hardening
- Billing/metering (vm_seconds + token_usage)
- Security hardening (network whitelist, VM timeout, concurrency limits)
- Monitoring/alerting (Prometheus + Grafana)
- Multi-node scaling
- User bring-your-own-key support
