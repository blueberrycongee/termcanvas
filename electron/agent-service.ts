/**
 * Agent service — bridges the agent runtime with Electron IPC.
 *
 * Runs in the main process. Each BubbleSession maps to an AgentSession
 * that holds its own message history and abort controller.
 * Stream events are forwarded to the renderer via BrowserWindow.webContents.
 */

import type { BrowserWindow } from "electron";
import { AnthropicProvider } from "../agent/src/provider/anthropic.ts";
import { OpenAIProvider } from "../agent/src/provider/openai.ts";
import { agentLoop } from "../agent/src/loop.ts";
import type { AgentEvent } from "../agent/src/loop.ts";
import type { LLMProvider } from "../agent/src/provider/types.ts";
import { ToolRegistry } from "../agent/src/tool.ts";
import { registerAllTools } from "../agent/src/tools/index.ts";
import type { Message } from "../agent/src/types.ts";
import { ClaudeCodeDriver } from "./claude-code-driver.ts";
import type { AgentStreamEvent } from "../src/types/index.ts";

interface AgentSession {
  messages: Message[];
  abortController: AbortController | null;
  running: boolean;
}

export interface AgentConfig {
  type: "anthropic" | "openai" | "claude-code";
  baseURL: string;
  apiKey: string;
  model: string;
  cwd?: string;
  resumeSessionId?: string;
}

const SYSTEM_PROMPT = `You are an AI assistant embedded in TermCanvas, a terminal-based canvas workspace.
You can help users manage terminals, projects, worktrees, and workflows through the available tools.
Be concise and direct. Respond in the same language the user uses.`;

function createProvider(config: AgentConfig): LLMProvider {
  if (config.type === "anthropic") {
    return new AnthropicProvider(
      config.apiKey,
      config.model,
      config.baseURL || undefined,
    );
  }
  return new OpenAIProvider(
    config.apiKey,
    config.model,
    config.baseURL || undefined,
  );
}

export class AgentService {
  private sessions = new Map<string, AgentSession>();
  private drivers = new Map<string, ClaudeCodeDriver>();
  private window: BrowserWindow | null = null;
  private tools: ToolRegistry;

  constructor() {
    this.tools = new ToolRegistry();
    registerAllTools(this.tools);
  }

  setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  private getSession(sessionId: string): AgentSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { messages: [], abortController: null, running: false };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private emit(sessionId: string, event: AgentEvent | { type: "stream_start" } | { type: "stream_end" }): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("agent:event", sessionId, event);
  }

  private emitStreamEvent(sessionId: string, event: AgentStreamEvent): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("agent:event", sessionId, event);
  }

  async send(sessionId: string, text: string, config: AgentConfig): Promise<void> {
    if (config.type === "claude-code") {
      this.sendClaudeCode(sessionId, text, config);
      return;
    }

    const session = this.getSession(sessionId);

    if (session.running) {
      this.emit(sessionId, {
        type: "error",
        error: new Error("Agent is already processing a message"),
      });
      return;
    }

    session.messages.push({ role: "user", content: text });

    const provider = createProvider(config);

    session.abortController = new AbortController();
    session.running = true;

    this.emit(sessionId, { type: "stream_start" });

    try {
      const loop = agentLoop(provider, this.tools, session.messages, {
        systemPrompt: SYSTEM_PROMPT,
        maxTurns: 20,
        signal: session.abortController.signal,
      });

      let result = await loop.next();
      while (!result.done) {
        const event = result.value;
        // Serialize errors (Error objects don't survive structured clone)
        if (event.type === "error") {
          this.emit(sessionId, {
            type: "error",
            error: new Error(event.error.message),
          });
        } else {
          this.emit(sessionId, event);
        }
        result = await loop.next();
      }

      const loopResult = result.value;
      session.messages = loopResult.messages;
    } catch (err) {
      this.emit(sessionId, {
        type: "error",
        error: new Error(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      session.running = false;
      session.abortController = null;
      this.emit(sessionId, { type: "stream_end" });
    }
  }

  private ensureDriver(sessionId: string, config: AgentConfig): ClaudeCodeDriver {
    let driver = this.drivers.get(sessionId);
    if (!driver) {
      driver = new ClaudeCodeDriver({
        sessionId,
        cwd: config.cwd ?? process.cwd(),
        model: config.model || undefined,
        resumeSessionId: config.resumeSessionId || undefined,
        env: { CLAUDE_CODE_NO_FLICKER: "0" },
      });
      driver.onEvent((event: AgentStreamEvent) => {
        this.emitStreamEvent(sessionId, event);
      });
      this.drivers.set(sessionId, driver);
    }
    driver.start();
    return driver;
  }

  startClaudeCode(sessionId: string, config: AgentConfig): { slashCommands: string[] } {
    const driver = this.ensureDriver(sessionId, config);
    return { slashCommands: driver.cachedSlashCommands ?? [] };
  }

  private sendClaudeCode(sessionId: string, text: string, config: AgentConfig): void {
    const driver = this.ensureDriver(sessionId, config);
    driver.send(text);
  }

  approve(sessionId: string, requestId: string): void {
    const driver = this.drivers.get(sessionId);
    if (driver) {
      driver.approve(requestId);
    }
  }

  deny(sessionId: string, requestId: string, reason?: string): void {
    const driver = this.drivers.get(sessionId);
    if (driver) {
      driver.deny(requestId, reason);
    }
  }

  abort(sessionId: string): void {
    const driver = this.drivers.get(sessionId);
    if (driver) {
      driver.abort();
      return;
    }
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
    }
  }

  clearSession(sessionId: string): void {
    const driver = this.drivers.get(sessionId);
    if (driver) {
      void driver.destroy();
      this.drivers.delete(sessionId);
      return;
    }
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.abortController) session.abortController.abort();
      session.messages = [];
      session.running = false;
      session.abortController = null;
    }
  }

  deleteSession(sessionId: string): void {
    const driver = this.drivers.get(sessionId);
    if (driver) {
      void driver.destroy();
      this.drivers.delete(sessionId);
      return;
    }
    const session = this.sessions.get(sessionId);
    if (session?.abortController) session.abortController.abort();
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
      session.running = false;
      session.abortController = null;
      session.messages = [];
    }
    this.sessions.clear();

    const drivers = [...this.drivers.values()];
    this.drivers.clear();
    await Promise.all(drivers.map((driver) => driver.destroy()));
  }
}
