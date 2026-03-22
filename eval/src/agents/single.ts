import { execFile, spawn as spawnChild } from "node:child_process";
import { join } from "node:path";
import type {
  AgentRunner,
  AgentRunResult,
  EvalConfig,
  TaskDefinition,
} from "../types.ts";

const COST_PER_1K_INPUT_TOKENS = 0.015;
const COST_PER_1K_OUTPUT_TOKENS = 0.075;
const DEFAULT_TIMEOUT_S = 600;

/** Build the prompt for the agent */
function buildPrompt(task: TaskDefinition): string {
  return [
    "You are a senior software engineer. Fix the following issue in this repository.",
    "Make minimal, targeted changes. Do not modify test files.",
    "After making your changes, commit them with a descriptive message.",
    "",
    `## Repository: ${task.repo}`,
    "",
    "## Issue",
    "",
    task.problem_statement,
    task.hints_text ? `\n## Hints\n\n${task.hints_text}` : "",
  ].join("\n");
}

/** Run a command with stdin support, return stdout */
function execWithStdin(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number; stdin?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnChild(cmd, args, {
      cwd: options.cwd,
      timeout: (options.timeout ?? DEFAULT_TIMEOUT_S) * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.on("error", reject);

    if (options.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}

/** Run an exec command and return stdout */
function exec(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: options.cwd,
        timeout: (options.timeout ?? DEFAULT_TIMEOUT_S) * 1000,
        maxBuffer: 50 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(error);
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      },
    );
  });
}

/** Parse Claude Code JSON output for token usage and cost */
function parseClaudeJsonOutput(output: string): {
  tokens: number;
  cost: number;
} {
  try {
    const data = JSON.parse(output);
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const totalCost = data.cost_usd ?? estimateCost(inputTokens + outputTokens);
    return { tokens: inputTokens + outputTokens, cost: totalCost };
  } catch {
    return { tokens: 0, cost: 0 };
  }
}

/** Estimate cost from tokens (rough approximation) */
function estimateCost(tokens: number): number {
  const inputTokens = tokens * 0.7;
  const outputTokens = tokens * 0.3;
  return (
    (inputTokens / 1000) * COST_PER_1K_INPUT_TOKENS +
    (outputTokens / 1000) * COST_PER_1K_OUTPUT_TOKENS
  );
}

/** Capture the git diff produced by the agent */
async function capturePatch(
  workDir: string,
  baseCommit: string,
): Promise<string> {
  // Check for committed changes first
  const { stdout: committedPatch } = await exec(
    "git",
    ["diff", baseCommit, "HEAD"],
    { cwd: workDir },
  );
  if (committedPatch.trim()) return committedPatch;

  // Fall back to uncommitted changes
  const { stdout: patch } = await exec("git", ["diff"], { cwd: workDir });
  return patch;
}

/** Single Claude Code agent runner */
export class SingleClaudeRunner implements AgentRunner {
  async run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult> {
    const prompt = buildPrompt(task);
    const timeoutS = config.timeout_per_task_s ?? DEFAULT_TIMEOUT_S;
    const startTime = Date.now();

    try {
      // Use stdin for prompt to avoid arg length limits (E2BIG)
      const { stdout, stderr } = await execWithStdin(
        "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--dangerously-skip-permissions",
          "--model",
          config.models.claude_model,
        ],
        { cwd: workDir, timeout: timeoutS, stdin: prompt },
      );

      const duration = (Date.now() - startTime) / 1000;
      const modelPatch = await capturePatch(workDir, task.base_commit);
      const { tokens, cost } = parseClaudeJsonOutput(stdout);

      return {
        model_patch: modelPatch,
        tokens,
        duration_s: Math.round(duration),
        cost_usd: cost,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      return {
        model_patch: "",
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/** Single Codex agent runner */
export class SingleCodexRunner implements AgentRunner {
  async run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult> {
    const prompt = buildPrompt(task);
    const timeoutS = config.timeout_per_task_s ?? DEFAULT_TIMEOUT_S;
    const startTime = Date.now();

    try {
      // Codex exec mode with full-auto for non-interactive
      const { stdout, stderr } = await execWithStdin(
        "codex",
        [
          "exec",
          "--full-auto",
          "--json",
          ...(config.models.codex_model ? ["-m", config.models.codex_model] : []),
        ],
        { cwd: workDir, timeout: timeoutS, stdin: prompt },
      );

      const duration = (Date.now() - startTime) / 1000;
      const modelPatch = await capturePatch(workDir, task.base_commit);

      // Parse codex JSON output for cost info
      let cost = 0;
      try {
        const lines = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const data = JSON.parse(lines[lines.length - 1]);
        cost = data.cost_usd ?? 0;
      } catch {}

      return {
        model_patch: modelPatch,
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: cost,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      return {
        model_patch: "",
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
