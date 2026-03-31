import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

test("server container assets enforce the hardened runtime contract", () => {
  const dockerfile = readRepoFile("server/Dockerfile");
  const compose = readRepoFile("server/docker-compose.yaml");
  const envExample = readRepoFile("server/.env.example");
  const dockerignore = readRepoFile(".dockerignore");

  assert.match(dockerfile, /FROM node:22-slim AS prod-deps/);
  assert.match(dockerfile, /COPY --from=prod-deps \/app\/node_modules \.\/node_modules/);
  assert.match(dockerfile, /USER termcanvas/);
  assert.match(dockerfile, /ENTRYPOINT \["tini", "--"\]/);
  assert.equal(dockerfile.includes("2>/dev/null || true"), false);

  assert.match(compose, /termcanvas-data:\/home\/termcanvas\/\.termcanvas/);
  assert.match(compose, /\$\{HOST_WORKSPACE_DIR:-\.\/_workspace\}:\$\{WORKSPACE_DIR:-\/workspace\}/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /stop_grace_period: 30s/);

  assert.match(envExample, /TERMCANVAS_INSTANCE=prod/);
  assert.match(envExample, /HOST_WORKSPACE_DIR=\.\/_workspace/);
  assert.match(envExample, /WORKSPACE_DIR=\/workspace/);

  for (const entry of [".git", ".hydra", ".worktrees", "node_modules"]) {
    assert.match(dockerignore, new RegExp(`^${entry.replace(".", "\\.")}$`, "m"));
  }
});

test("deployment guide covers auth, volumes, callbacks, and remote workflow control", () => {
  const guide = readRepoFile("docs/headless-cloud-deployment.md");

  for (const snippet of [
    "TERMCANVAS_API_TOKEN",
    "HOST_WORKSPACE_DIR",
    "WORKSPACE_DIR=/workspace",
    "TERMCANVAS_WEBHOOK_URL",
    "RESULT_CALLBACK_URL",
    "TERMCANVAS_URL",
    "termcanvas workflow run",
    "/workspace",
  ]) {
    assert.equal(guide.includes(snippet), true, `missing guide snippet: ${snippet}`);
  }
});
