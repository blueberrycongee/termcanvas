# TermCanvas Cloud — Headless Server
FROM node:22-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

# Install build dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source
COPY tsconfig.headless.build.json ./
COPY headless-runtime/ headless-runtime/
COPY hydra/ hydra/
COPY electron/pty-manager.ts electron/pty-launch.ts electron/telemetry-service.ts \
     electron/process-detector.ts electron/session-watcher.ts electron/project-scanner.ts \
     electron/git-diff.ts electron/memory-service.ts electron/memory-index-generator.ts \
     electron/
COPY shared/ shared/

# Build
RUN pnpm exec tsc -p tsconfig.headless.build.json

# Compile production-only dependencies in a disposable layer so the final
# image does not need build-essential or python.
FROM node:22-slim AS prod-deps

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies without running the root postinstall, then
# rebuild node-pty explicitly for the target image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
  && pnpm rebuild node-pty

# --- Runtime ---
FROM node:22-slim

ARG TERMCANVAS_AGENT_CLI_PACKAGE=@openai/codex

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist-headless/ dist-headless/

RUN npm install -g "$TERMCANVAS_AGENT_CLI_PACKAGE" \
  && groupadd --gid 10001 termcanvas \
  && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin termcanvas \
  && mkdir -p /workspace /home/termcanvas/.termcanvas \
  && chown -R termcanvas:termcanvas /app /workspace /home/termcanvas

USER termcanvas

ENV HOME=/home/termcanvas
ENV NODE_ENV=production
ENV TERMCANVAS_INSTANCE=prod
ENV TERMCANVAS_HOST=0.0.0.0
ENV TERMCANVAS_PORT=7080
ENV WORKSPACE_DIR=/workspace

EXPOSE 7080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:7080/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-specifier-resolution=node", "dist-headless/headless-runtime/index.js"]
