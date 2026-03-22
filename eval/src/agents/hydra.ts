import { execFile, spawn as spawnChild } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentRunner,
  AgentRunResult,
  EvalConfig,
  TaskDefinition,
} from "../types.ts";

const DEFAULT_TIMEOUT_S = 1200;
const POLL_INTERVAL_MS = 15_000;

/** Run a command and return stdout */
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

/** Run a command with stdin */
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
        reject(new Error(`Process exited with code ${code}: ${stderr.slice(0, 500)}`));
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

/** Capture the git diff produced by the agent */
async function capturePatch(
  workDir: string,
  baseCommit: string,
): Promise<string> {
  const { stdout: committedPatch } = await exec(
    "git",
    ["diff", baseCommit, "HEAD"],
    { cwd: workDir },
  );
  if (committedPatch.trim()) return committedPatch;
  const { stdout: patch } = await exec("git", ["diff"], { cwd: workDir });
  return patch;
}

/**
 * Direct Hydra runner — multi-agent orchestration without TermCanvas.
 *
 * Flow:
 * 1. Orchestrator (Claude) analyzes the problem and produces a plan with sub-tasks
 * 2. Each sub-task is assigned to a sub-agent (Claude or Codex) in a git worktree
 * 3. Sub-agents work in parallel
 * 4. Results are merged back
 */
export class HydraRunner implements AgentRunner {
  async run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult> {
    const timeoutS = config.timeout_per_task_s ?? DEFAULT_TIMEOUT_S;
    const startTime = Date.now();
    const subAgentTypes = config.sub_agent_types ?? ["claude", "codex"];

    try {
      // Phase 1: Orchestrator analyzes and decomposes the task
      console.log(`    [hydra] Phase 1: Orchestrator analyzing task...`);
      const plan = await this.decompose(task, workDir, config);

      if (plan.subtasks.length === 0) {
        // Orchestrator decided task is not decomposable — run as single agent
        console.log(`    [hydra] Not decomposable, falling back to single agent`);
        return this.runSingleFallback(task, workDir, config, startTime);
      }

      console.log(`    [hydra] Decomposed into ${plan.subtasks.length} sub-tasks`);

      // Phase 2: Create worktrees and spawn sub-agents
      console.log(`    [hydra] Phase 2: Spawning ${plan.subtasks.length} sub-agents...`);
      const subResults = await Promise.all(
        plan.subtasks.map((subtask, i) => {
          const agentType = subAgentTypes[i % subAgentTypes.length];
          return this.runSubAgent(
            subtask,
            task,
            workDir,
            agentType,
            config,
            i,
            timeoutS,
          );
        }),
      );

      // Phase 3: Merge all sub-agent changes
      console.log(`    [hydra] Phase 3: Merging results...`);
      let mergeFailures = 0;
      for (const sub of subResults) {
        if (sub.branch && !sub.error) {
          const merged = await exec("git", ["merge", sub.branch, "--no-edit"], {
            cwd: workDir,
            timeout: 30,
          }).then(() => true).catch(() => {
            console.log(`    [hydra] Merge conflict on ${sub.branch}, trying theirs strategy`);
            return exec(
              "git",
              ["merge", sub.branch!, "--no-edit", "-X", "theirs"],
              { cwd: workDir, timeout: 30 },
            ).then(() => true).catch(() => {
              return exec("git", ["merge", "--abort"], {
                cwd: workDir,
                timeout: 10,
              }).catch(() => {}).then(() => false);
            });
          });
          if (!merged) {
            mergeFailures++;
          }
        }
      }

      // Cleanup worktrees
      for (const sub of subResults) {
        if (sub.worktreePath) {
          await exec("git", ["worktree", "remove", sub.worktreePath, "--force"], {
            cwd: workDir,
            timeout: 30,
          }).catch(() => {});
          if (sub.branch) {
            await exec("git", ["branch", "-D", sub.branch], {
              cwd: workDir,
              timeout: 10,
            }).catch(() => {});
          }
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      const modelPatch = await capturePatch(workDir, task.base_commit);

      return {
        model_patch: modelPatch,
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: 0,
        sub_agents: plan.subtasks.length,
        merge_failures: mergeFailures,
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

  /** Use orchestrator to decompose the task into sub-tasks */
  private async decompose(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<{ subtasks: string[] }> {
    const orchestratorModel = config.models.hydra_orchestrator_model;
    const normalizedModel = orchestratorModel.toLowerCase();

    const prompt = [
      "You are a task decomposition engine. Analyze this issue and break it into independent sub-tasks.",
      "Each sub-task should be independently implementable in a separate git branch.",
      "",
      "IMPORTANT: Respond ONLY with a JSON array of strings, each being a sub-task description.",
      "If the task cannot be meaningfully decomposed (e.g., it's a single logical change), respond with an empty array [].",
      "Do NOT include test-writing tasks. Only include code changes.",
      "Keep sub-tasks to 2-4 maximum.",
      "",
      `## Repository: ${task.repo}`,
      "",
      "## Issue",
      "",
      task.problem_statement,
    ].join("\n");

    try {
      if (
        normalizedModel.startsWith("gpt") ||
        normalizedModel.includes("codex")
      ) {
        const { stdout } = await execWithStdin(
          "codex",
          [
            "exec",
            "--full-auto",
            "--json",
            ...(normalizedModel === "codex" ? [] : ["-m", orchestratorModel]),
          ],
          { cwd: workDir, timeout: 120, stdin: prompt },
        );
        return this.parseDecomposition(stdout);
      }

      const { stdout } = await execWithStdin(
        "claude",
        ["-p", "--output-format", "text", "--dangerously-skip-permissions", "--model", config.models.hydra_orchestrator_model],
        { cwd: workDir, timeout: 120, stdin: prompt },
      );
      return this.parseDecomposition(stdout);
    } catch {
      return { subtasks: [] };
    }
  }

  /** Parse the orchestrator's decomposition output */
  private parseDecomposition(output: string): { subtasks: string[] } {
    // Try to extract JSON array from the output
    const jsonMatch = output.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return { subtasks: [] };

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
        return { subtasks: parsed.slice(0, 4) }; // Cap at 4
      }
    } catch {}

    return { subtasks: [] };
  }

  /** Run a sub-agent in an isolated worktree */
  private async runSubAgent(
    subtask: string,
    task: TaskDefinition,
    mainWorkDir: string,
    agentType: string,
    config: EvalConfig,
    index: number,
    timeoutS: number,
  ): Promise<{ branch: string | null; worktreePath: string | null; error?: string }> {
    const safeInstanceId = task.instance_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const branchName = `hydra-eval-sub-${safeInstanceId}-${index}`;
    const worktreePath = join(
      mainWorkDir,
      `..`,
      `.hydra-wt-${safeInstanceId}-${index}`,
    );

    try {
      // Create worktree
      await exec(
        "git",
        ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
        { cwd: mainWorkDir, timeout: 30 },
      );

      const prompt = [
        `You are working on a sub-task for the ${task.repo} repository.`,
        "Make minimal, targeted changes. Do not modify test files.",
        "Commit your changes when done.",
        "",
        "## Sub-task",
        "",
        subtask,
        "",
        "## Context (original issue)",
        "",
        task.problem_statement.slice(0, 2000),
      ].join("\n");

      console.log(`    [hydra] Sub-agent ${index} (${agentType}): starting...`);

      if (agentType === "codex") {
        await execWithStdin(
          "codex",
          [
            "exec",
            "--full-auto",
            ...(config.models.hydra_sub_codex_model ? ["-m", config.models.hydra_sub_codex_model] : []),
          ],
          { cwd: worktreePath, timeout: timeoutS, stdin: prompt },
        );
      } else {
        await execWithStdin(
          "claude",
          ["-p", "--output-format", "text", "--dangerously-skip-permissions", "--model", config.models.hydra_sub_claude_model],
          { cwd: worktreePath, timeout: timeoutS, stdin: prompt },
        );
      }

      console.log(`    [hydra] Sub-agent ${index} (${agentType}): done`);
      return { branch: branchName, worktreePath };
    } catch (error) {
      console.log(`    [hydra] Sub-agent ${index} (${agentType}): failed - ${error instanceof Error ? error.message : String(error)}`);
      return {
        branch: branchName,
        worktreePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Fallback: run as a single agent when decomposition isn't possible */
  private async runSingleFallback(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
    startTime: number,
  ): Promise<AgentRunResult> {
    const timeoutS = config.timeout_per_task_s ?? DEFAULT_TIMEOUT_S;
    const prompt = [
      `Fix this issue in the ${task.repo} repository.`,
      "Make minimal, targeted changes. Do not modify test files.",
      "Commit your changes.",
      "",
      "## Issue",
      "",
      task.problem_statement,
      task.hints_text ? `\n## Hints\n\n${task.hints_text}` : "",
    ].join("\n");

    try {
      await execWithStdin(
        "claude",
        ["-p", "--output-format", "text", "--dangerously-skip-permissions", "--model", config.models.hydra_sub_claude_model],
        { cwd: workDir, timeout: timeoutS, stdin: prompt },
      );

      const duration = (Date.now() - startTime) / 1000;
      const modelPatch = await capturePatch(workDir, task.base_commit);

      return {
        model_patch: modelPatch,
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: 0,
        sub_agents: 1,
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

/** Original TermCanvas-based Hydra runner (for use within TermCanvas projects) */
export class TermCanvasHydraRunner implements AgentRunner {
  async run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult> {
    const taskDesc = [
      `Fix this issue in the ${task.repo} repository.`,
      "Analyze the problem, break it into sub-tasks if beneficial, and fix it.",
      "Make minimal, targeted changes. Do not modify test files.",
      "Commit all changes before finishing.",
      "",
      "## Issue",
      "",
      task.problem_statement,
      task.hints_text ? `\n## Hints\n\n${task.hints_text}` : "",
    ].join("\n");

    const timeoutS = config.timeout_per_task_s ?? DEFAULT_TIMEOUT_S;
    const startTime = Date.now();

    try {
      const agentType = config.models.hydra_orchestrator_model;
      const { stdout: spawnOutput } = await exec(
        "hydra",
        [
          "spawn",
          "--task", taskDesc,
          "--type", agentType,
          "--repo", workDir,
          "--auto-approve",
        ],
        { cwd: workDir, timeout: 60 },
      );

      const spawnResult = JSON.parse(spawnOutput) as {
        agentId: string;
        resultFile: string;
        worktreePath: string;
        branch: string;
      };

      // Poll for result file
      const deadline = Date.now() + timeoutS * 1000;
      while (Date.now() < deadline) {
        try {
          await access(spawnResult.resultFile);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
      }

      const duration = (Date.now() - startTime) / 1000;

      const { stdout: patch } = await exec(
        "git",
        ["diff", task.base_commit, "HEAD"],
        { cwd: spawnResult.worktreePath },
      ).catch(() => ({ stdout: "", stderr: "" }));

      if (patch) {
        await exec("git", ["merge", spawnResult.branch, "--no-edit"], {
          cwd: workDir,
          timeout: 30,
        }).catch(() => {});
      }

      await exec("hydra", ["cleanup", spawnResult.agentId, "--force"], {
        cwd: workDir,
        timeout: 30,
      }).catch(() => {});

      return {
        model_patch: patch,
        tokens: 0,
        duration_s: Math.round(duration),
        cost_usd: 0,
        sub_agents: 1,
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
