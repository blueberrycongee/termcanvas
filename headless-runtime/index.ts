/**
 * Headless runtime entry point for cloud sandbox execution.
 * Wires together all services and handles lifecycle.
 */

import fs from "node:fs";
import path from "node:path";
import { PtyManager } from "../electron/pty-manager.ts";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { ProjectScanner } from "../electron/project-scanner.ts";
import { ProjectStore } from "./project-store.ts";
import { HeadlessApiServer } from "./api-server.ts";
import { Heartbeat } from "./heartbeat.ts";
import {
  resolveTermCanvasPortFile,
  resolveTermCanvasInstance,
  getTermCanvasDataDir,
} from "../shared/termcanvas-instance.ts";

interface HeadlessConfig {
  taskId: string | undefined;
  resultCallbackUrl: string | undefined;
  gitRepoUrl: string | undefined;
  workspaceDir: string;
  s3Endpoint: string | undefined;
  s3Bucket: string | undefined;
}

function loadConfig(): HeadlessConfig {
  return {
    taskId: process.env.TASK_ID,
    resultCallbackUrl: process.env.RESULT_CALLBACK_URL,
    gitRepoUrl: process.env.GIT_REPO_URL,
    workspaceDir: process.env.WORKSPACE_DIR ?? process.cwd(),
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(
    `[headless] starting — workspace=${config.workspaceDir} taskId=${config.taskId ?? "none"}`,
  );

  // Initialize services (reuse existing modules with zero Electron deps)
  const ptyManager = new PtyManager();
  const telemetryService = new TelemetryService();
  const projectScanner = new ProjectScanner();
  const projectStore = new ProjectStore();

  // Create and start API server
  const apiServer = new HeadlessApiServer({
    projectStore,
    ptyManager,
    projectScanner,
    telemetryService,
    workspaceDir: config.workspaceDir,
  });

  const port = await apiServer.start();
  console.log(`[headless] API server listening on port ${port}`);

  // Write port file for discovery
  const portFile = resolveTermCanvasPortFile();
  const dataDir = getTermCanvasDataDir(resolveTermCanvasInstance());
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(portFile, String(port), "utf-8");
  console.log(`[headless] port file written: ${portFile}`);

  // Start heartbeat if callback URL is configured
  let heartbeat: Heartbeat | null = null;
  if (config.resultCallbackUrl) {
    heartbeat = new Heartbeat({
      callbackUrl: config.resultCallbackUrl,
    });
    heartbeat.start();
    console.log(
      `[headless] heartbeat started -> ${config.resultCallbackUrl}`,
    );
  }

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("[headless] shutting down...");

    heartbeat?.stop();
    apiServer.stop();

    void ptyManager.destroyAll().finally(() => {
      // Remove port file
      try {
        fs.unlinkSync(portFile);
      } catch {
        // Port file may already be removed
      }

      console.log("[headless] shutdown complete");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[headless] fatal error:", err);
  process.exit(1);
});
