# TermCanvas Headless Cloud Deployment

This guide covers the docker-compose deployment path for the TermCanvas headless runtime introduced across the cloud rollout rounds.

## What This Stack Provides

- A remotely reachable TermCanvas headless API on `TERMCANVAS_PORT`
- Authenticated project, terminal, workflow, worktree, telemetry, and diff control
- Persistent TermCanvas state under the container user home
- A bind-mounted workspace root at `/workspace` for repos and Hydra worktrees
- Optional lifecycle webhooks and optional heartbeat callbacks

## Prerequisites

- Docker Engine with Compose support
- A host directory that will hold your repos/worktrees
- The `termcanvas` CLI available wherever you plan to issue remote commands
- API keys for whichever agent CLIs you want to run inside the container

Run the compose stack from `server/` so `.env` and relative bind mounts resolve predictably.

## 1. Configure Environment

```bash
cd server
cp .env.example .env
openssl rand -hex 32
```

Put the generated token into `TERMCANVAS_API_TOKEN`.

Important variables:

- `TERMCANVAS_API_TOKEN`
  Required. All control routes except `/health`, `/health/live`, and `/health/ready` require `Authorization: Bearer <token>`.
- `HOST_WORKSPACE_DIR`
  Host path that docker-compose bind-mounts into the container.
- `WORKSPACE_DIR=/workspace`
  In-container workspace root. Remote CLI commands must use paths under this root, for example `/workspace/my-repo`.
- `TERMCANVAS_WEBHOOK_URL`
  Optional lifecycle webhook target for `server_*`, `terminal_*`, and `workflow_*` events.
- `TERMCANVAS_WEBHOOK_SECRET`
  Optional shared secret for webhook signing via `X-Webhook-Signature`.
- `RESULT_CALLBACK_URL`
  Optional heartbeat target. The headless runtime POSTs a JSON heartbeat roughly every 10 seconds while the server is running.
- `TERMCANVAS_AGENT_CLI_PACKAGE`
  Build-time package name installed into the image. The compose default is `@openai/codex`.

Provider credentials such as `OPENAI_API_KEY` are passed through to spawned agent terminals.

## 2. Start The Stack

```bash
docker compose up --build -d
```

The compose file mounts:

- `termcanvas-data:/home/termcanvas/.termcanvas`
  Persistent TermCanvas state, including the runtime port file and saved canvas/project state.
- `${HOST_WORKSPACE_DIR}:${WORKSPACE_DIR}`
  Your repo/worktree root. Hydra-created worktrees appear under this mount.

The image runs as the unprivileged `termcanvas` user, uses `tini` as PID 1 for signal forwarding, and expects Docker to stop it with a grace window so pending state can flush before exit.

## 3. Verify Health

Public health endpoints:

```bash
curl http://localhost:7080/health
curl http://localhost:7080/health/live
curl http://localhost:7080/health/ready
```

Authenticated status example:

```bash
curl \
  -H "Authorization: Bearer ${TERMCANVAS_API_TOKEN}" \
  http://localhost:7080/api/status
```

## 4. Connect With The Remote CLI

The `termcanvas` CLI is only an HTTP client in this mode. Paths passed to it are evaluated by the server, not by the machine where you run the command.

Set connection variables:

```bash
export TERMCANVAS_URL=http://your-server-host:7080
export TERMCANVAS_API_TOKEN=your-shared-token
```

Example flow:

```bash
termcanvas project add /workspace/my-repo

termcanvas workflow run \
  --repo /workspace/my-repo \
  --worktree /workspace/my-repo \
  --all-type codex \
  --task "Audit and fix the failing API path"

termcanvas workflow list --repo /workspace/my-repo
termcanvas workflow status <workflow-id> --repo /workspace/my-repo
termcanvas workflow watch <workflow-id> --repo /workspace/my-repo

termcanvas worktree create --repo /workspace/my-repo --branch feature/cloud-fix
termcanvas worktree list --repo /workspace/my-repo
```

If you run the CLI from outside the container host, keep using server-visible paths like `/workspace/my-repo`. Do not pass your local laptop path.

## 5. Webhooks And Result Callbacks

- `TERMCANVAS_WEBHOOK_URL`
  Receives lifecycle notifications for server, terminal, and workflow events. When `TERMCANVAS_WEBHOOK_SECRET` is set, payloads are signed in `X-Webhook-Signature`.
- `RESULT_CALLBACK_URL`
  Receives heartbeat payloads that include workflow summary, terminal/workflow counts, memory usage, and uptime.

Use both when you need push-based monitoring:

- Webhooks for discrete lifecycle events
- Result callback for periodic liveness/progress heartbeat

## 6. Agent CLI Packages

The base image installs Codex during the Docker build. If you want a different default package, rebuild with a different package name:

```bash
docker compose build \
  --build-arg TERMCANVAS_AGENT_CLI_PACKAGE=@openai/codex
```

If you need additional providers, extend the base image in your own Dockerfile and install the extra CLIs there.

## 7. Operational Notes

- `/health*` stays public by design so orchestrators can probe the service.
- `/api/status` and all workflow/worktree control routes stay behind `TERMCANVAS_API_TOKEN`.
- Docker state lives in `/home/termcanvas/.termcanvas`; workspace repos/worktrees live under `/workspace`.
- Stopping the container with `docker stop` should flush pending state, tear down PTYs, emit `server_stopping`, and remove the runtime port file before exit.
