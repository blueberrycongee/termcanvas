import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { shell } from "electron";

const DEFAULT_PORT = 17394;
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 200;

export interface ComputerUseState {
  enabled: boolean;
  helperRunning: boolean;
  helperPid: number | null;
  port: number | null;
  accessibilityGranted: boolean | null;
  screenRecordingGranted: boolean | null;
  error: string | null;
}

export interface ComputerUseStatus {
  enabled: boolean;
  helperRunning: boolean;
  accessibilityGranted: boolean;
  screenRecordingGranted: boolean;
}

interface StateFileData {
  enabled: boolean;
  port: number;
  token: string;
  pid: number;
  helper_path: string;
}

function getStateDir(): string {
  return path.join(os.homedir(), ".termcanvas", "computer-use");
}

function getStateFilePath(): string {
  return path.join(getStateDir(), "state.json");
}

async function findFreePort(preferred: number): Promise<number> {
  const { createServer } = await import("net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const server2 = createServer();
      server2.listen(0, "127.0.0.1", () => {
        const addr = server2.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        server2.close(() => resolve(port));
      });
      server2.on("error", reject);
    });
  });
}

async function httpRequest(
  method: string,
  port: number,
  urlPath: string,
  token: string,
): Promise<{ status: number; body: string }> {
  const http = await import("http");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          "X-Token": token,
          "Content-Type": "application/json",
        },
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", reject);
    req.end();
  });
}

export class ComputerUseManager {
  private helperProcess: ChildProcess | null = null;
  private port: number | null = null;
  private token: string = "";
  private state: ComputerUseState = {
    enabled: false,
    helperRunning: false,
    helperPid: null,
    port: null,
    accessibilityGranted: null,
    screenRecordingGranted: null,
    error: null,
  };
  private listeners = new Set<(state: ComputerUseState) => void>();

  async enable(): Promise<void> {
    if (this.state.enabled && this.helperProcess) {
      await this.requestPermissions();
      const perms = await this.checkPermissions();
      this.updateState({
        accessibilityGranted: perms.accessibility,
        screenRecordingGranted: perms.screenRecording,
      });
      return;
    }

    try {
      this.token = crypto.randomBytes(32).toString("hex");
      this.port = await findFreePort(DEFAULT_PORT);

      const helperPath = this.resolveHelperPath();
      if (!fs.existsSync(helperPath)) {
        throw new Error(`Helper binary not found at ${helperPath}`);
      }

      this.helperProcess = spawn(
        helperPath,
        ["--port", String(this.port), "--token", this.token],
        {
          stdio: "ignore",
          detached: false,
        },
      );

      this.helperProcess.on("exit", (code) => {
        console.log(`[ComputerUse] Helper exited with code ${code}`);
        this.helperProcess = null;
        this.updateState({
          helperRunning: false,
          helperPid: null,
          error: code !== 0 ? `Helper exited with code ${code}` : null,
        });
      });

      await this.waitForHealthCheck();

      await this.writeStateFile();

      this.updateState({
        enabled: true,
        helperRunning: true,
        helperPid: this.helperProcess?.pid ?? null,
        port: this.port,
        error: null,
      });

      await this.requestPermissions();

      const perms = await this.checkPermissions();
      this.updateState({
        accessibilityGranted: perms.accessibility,
        screenRecordingGranted: perms.screenRecording,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ComputerUse] Enable failed:", message);
      if (this.helperProcess) {
        this.helperProcess.kill();
        this.helperProcess = null;
      }
      this.updateState({
        enabled: false,
        helperRunning: false,
        helperPid: null,
        port: null,
        error: message,
      });
      throw err;
    }
  }

  async disable(): Promise<void> {
    if (this.helperProcess) {
      this.helperProcess.kill();
      this.helperProcess = null;
    }
    await this.removeStateFile();
    this.updateState({
      enabled: false,
      helperRunning: false,
      helperPid: null,
      port: null,
      accessibilityGranted: null,
      screenRecordingGranted: null,
      error: null,
    });
  }

  async stop(): Promise<void> {
    if (this.port && this.token) {
      try {
        await httpRequest("POST", this.port, "/stop", this.token);
      } catch {
        // Helper may already be stopped
      }
    }
    await this.disable();
  }

  async setup(): Promise<ComputerUseStatus> {
    await this.enable();
    const status = await this.getStatus();
    if (!status.accessibilityGranted || !status.screenRecordingGranted) {
      this.openPermissions();
    }
    return status;
  }

  async getStatus(): Promise<ComputerUseStatus> {
    if (!this.state.enabled || !this.port || !this.token) {
      return {
        enabled: false,
        helperRunning: false,
        accessibilityGranted: false,
        screenRecordingGranted: false,
      };
    }

    try {
      await httpRequest("GET", this.port, "/health", this.token);
      const perms = await this.checkPermissions();
      return {
        enabled: true,
        helperRunning: true,
        accessibilityGranted: perms.accessibility,
        screenRecordingGranted: perms.screenRecording,
      };
    } catch {
      return {
        enabled: this.state.enabled,
        helperRunning: false,
        accessibilityGranted: false,
        screenRecordingGranted: false,
      };
    }
  }

  async checkPermissions(): Promise<{
    accessibility: boolean;
    screenRecording: boolean;
  }> {
    if (!this.port || !this.token) {
      return { accessibility: false, screenRecording: false };
    }

    try {
      const resp = await httpRequest(
        "POST",
        this.port,
        "/status",
        this.token,
      );
      const data = JSON.parse(resp.body);
      return {
        accessibility: data.accessibility_granted ?? false,
        screenRecording: data.screen_recording_granted ?? false,
      };
    } catch {
      return { accessibility: false, screenRecording: false };
    }
  }

  async requestPermissions(): Promise<void> {
    if (!this.port || !this.token) {
      return;
    }

    const resp = await httpRequest(
      "POST",
      this.port,
      "/request_permissions",
      this.token,
    );
    const data = JSON.parse(resp.body);
    this.updateState({
      accessibilityGranted: data.accessibility_granted ?? false,
      screenRecordingGranted: data.screen_recording_granted ?? false,
    });
  }

  openPermissions(): void {
    void this.requestPermissions();
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  }

  async shutdown(): Promise<void> {
    await this.disable();
  }

  onStateChange(callback: (state: ComputerUseState) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getState(): ComputerUseState {
    return { ...this.state };
  }

  private resolveHelperPath(): string {
    const isDev = !!process.env.VITE_DEV_SERVER_URL;

    if (isDev) {
      return path.join(
        process.cwd(),
        "native",
        "computer-use-helper",
        ".build",
        "debug",
        "computer-use-helper",
      );
    }

    const bundledPath = path.join(
      process.resourcesPath,
      "computer-use-helper",
    );
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }

    return path.join(
      process.cwd(),
      "native",
      "computer-use-helper",
      ".build",
      "release",
      "computer-use-helper",
    );
  }

  private async waitForHealthCheck(): Promise<void> {
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const resp = await httpRequest(
          "GET",
          this.port!,
          "/health",
          this.token,
        );
        if (resp.status === 200) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
    }
    throw new Error("Helper health check timed out");
  }

  private async writeStateFile(): Promise<void> {
    const dir = getStateDir();
    fs.mkdirSync(dir, { recursive: true });
    const statePath = getStateFilePath();
    const tmpPath = `${statePath}.tmp.${process.pid}`;

    const data: StateFileData = {
      enabled: true,
      port: this.port!,
      token: this.token,
      pid: this.helperProcess?.pid ?? 0,
      helper_path: this.resolveHelperPath(),
    };

    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    if (process.platform !== "win32") {
      fs.chmodSync(tmpPath, 0o600);
    }
    fs.renameSync(tmpPath, statePath);
  }

  private async removeStateFile(): Promise<void> {
    try {
      fs.unlinkSync(getStateFilePath());
    } catch {
      // File may not exist
    }
  }

  private updateState(partial: Partial<ComputerUseState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Don't let listener errors propagate
      }
    }
  }
}
