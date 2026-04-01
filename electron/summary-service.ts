import fs from "fs";
import { spawn } from "child_process";
import { buildCliInvocationArgs } from "./insights-cli";
import { buildLaunchSpec } from "./pty-launch";
import { resolveSessionFile } from "./session-watcher";

type SummaryCli = "claude" | "codex";
type SessionType = "claude" | "codex";

interface SummaryInput {
  terminalId: string;
  sessionId: string;
  sessionType: SessionType;
  cwd: string;
  summaryCli: SummaryCli;
}

interface SummaryResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

const TIMEOUT_MS = 30_000;
const MAX_TAIL_BYTES = 65_536;

const inFlight = new Set<string>();

function readSessionTail(sessionFile: string): string {
  const stat = fs.statSync(sessionFile);
  const size = stat.size;
  const start = Math.max(0, size - MAX_TAIL_BYTES);
  const length = size - start;

  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(sessionFile, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  const raw = buffer.toString("utf-8");
  const lines = raw.split("\n").filter(Boolean);

  // If we started mid-file, the first line is likely truncated — drop it
  const validLines = start > 0 ? lines.slice(1) : lines;

  const messages: string[] = [];
  for (const line of validLines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const role = entry.role as string | undefined;
      const type = entry.type as string | undefined;

      if (role === "user" || role === "assistant") {
        const text = extractText(entry.content);
        if (text) messages.push(`[${role}] ${text}`);
      } else if (type === "user" || type === "assistant") {
        const text = extractText(entry.message ?? entry.content);
        if (text) messages.push(`[${type}] ${text}`);
      }
    } catch {
      // skip malformed lines
    }
  }

  return messages.join("\n");
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 2000);
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text;
      if (typeof entry.content === "string") return entry.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

function buildSummaryPrompt(sessionContent: string): string {
  return `Summarize this CLI terminal session in exactly ONE short sentence (under 60 characters). The summary should describe the main task or topic. Output ONLY the summary sentence, nothing else. Detect the language of the conversation and reply in that same language.\n\n${sessionContent}`;
}

async function invokeSummaryCli(
  cliTool: SummaryCli,
  prompt: string,
): Promise<string> {
  const spec = await buildLaunchSpec({ cwd: process.cwd(), shell: cliTool });
  const invocation = buildCliInvocationArgs(spec.args, cliTool, prompt);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(spec.file, invocation.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error("Summary CLI timed out"));
        return;
      }
      if (code !== 0 && code !== null) {
        reject(new Error(`Summary CLI exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (invocation.stdin !== null) {
      child.stdin.write(invocation.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export async function generateSummary(
  input: SummaryInput,
): Promise<SummaryResult> {
  const { terminalId, sessionId, sessionType, cwd, summaryCli } = input;

  if (inFlight.has(terminalId)) {
    return { ok: false, error: "Summary already in progress for this terminal" };
  }

  const sessionFile = resolveSessionFile(sessionId, sessionType, cwd);
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return { ok: false, error: "Session file not found" };
  }

  inFlight.add(terminalId);
  try {
    const content = readSessionTail(sessionFile);
    if (!content) {
      return { ok: false, error: "No session content to summarize" };
    }

    const prompt = buildSummaryPrompt(content);
    const raw = await invokeSummaryCli(summaryCli, prompt);
    const summary = raw.trim().replace(/\n+/g, " ").slice(0, 120);

    if (!summary) {
      return { ok: false, error: "CLI returned empty response" };
    }

    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    inFlight.delete(terminalId);
  }
}
