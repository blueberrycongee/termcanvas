/** Agent execution mode */
export type AgentMode = "single-claude" | "single-codex" | "hydra";

/** Model configuration for all agent roles */
export interface ModelConfig {
  /** Claude model for single-claude mode (e.g. "sonnet", "opus") */
  claude_model: string;
  /** Codex model for single-codex mode (e.g. "gpt-5.4", "o3") */
  codex_model?: string;
  /** Model for Hydra orchestrator — the most critical role */
  hydra_orchestrator_model: string;
  /** Claude model for Hydra sub-agents */
  hydra_sub_claude_model: string;
  /** Codex model for Hydra sub-agents */
  hydra_sub_codex_model?: string;
}

/** Default model configuration */
export const DEFAULT_MODELS: ModelConfig = {
  claude_model: "sonnet",
  codex_model: undefined, // uses codex config.toml default
  hydra_orchestrator_model: "sonnet", // NOT haiku — orchestrator needs strong reasoning
  hydra_sub_claude_model: "sonnet",
  hydra_sub_codex_model: undefined,
};

/** Configuration for a single evaluation run */
export interface EvalConfig {
  /** Unique run identifier, e.g. "run-20260322-001" */
  run_id: string;
  /** Agent mode */
  mode: AgentMode;
  /** Model configuration */
  models: ModelConfig;
  /** For Hydra: sub-agent type combination */
  sub_agent_types?: string[];
  /** Prompt version tag for tracking prompt iterations */
  prompt_version: string;
  /** Benchmark name, e.g. "swe-bench" */
  benchmark: string;
  /** Task filter tag, e.g. "multi-file" */
  task_filter?: string;
  /** Max concurrent tasks */
  max_workers?: number;
  /** Timeout per task in seconds */
  timeout_per_task_s?: number;
  /** Whether to run SWE-bench Docker evaluation */
  run_swebench_eval?: boolean;
}

/** A single SWE-bench task definition */
export interface TaskDefinition {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text: string;
  patch: string;
  test_patch: string;
  FAIL_TO_PASS: string;
  PASS_TO_PASS: string;
  version: string;
  environment_setup_commit: string;
  created_at: string;
}

/** Metadata about a task (derived from TaskDefinition) */
export interface TaskMeta {
  instance_id: string;
  repo: string;
  num_files: number;
  files_changed: string[];
  num_lines: number;
}

/** Result of a single task execution */
export interface TaskResult {
  task_id: string;
  pass: boolean;
  model_patch: string;
  tokens: number;
  duration_s: number;
  cost_usd: number;
  sub_agents?: number;
  merge_failures?: number;
  error?: string;
  /** Detailed evaluation breakdown */
  eval_detail?: {
    applied: boolean;
    tests_passed: boolean;
    eval_method?: string;
    fail_to_pass_results?: Record<string, boolean>;
  };
}

/** Summary statistics for a run */
export interface RunSummary {
  total: number;
  resolved: number;
  pass_rate: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_duration_s: number;
}

/** Complete result of an evaluation run */
export interface RunResult {
  run_id: string;
  config: EvalConfig;
  started_at: string;
  completed_at: string;
  tasks: TaskResult[];
  summary: RunSummary;
}

/** Prediction entry for SWE-bench evaluation */
export interface SWEBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

/** Comparison between two runs */
export interface RunComparison {
  run_a: string;
  run_b: string;
  config_diff: Record<string, { a: unknown; b: unknown }>;
  task_diffs: TaskDiff[];
  summary_diff: {
    pass_rate: { a: number; b: number; delta: number };
    total_tokens: { a: number; b: number; delta: number };
    total_cost_usd: { a: number; b: number; delta: number };
    avg_duration_s: { a: number; b: number; delta: number };
  };
}

/** Per-task comparison */
export interface TaskDiff {
  task_id: string;
  pass: { a: boolean; b: boolean };
  tokens: { a: number; b: number };
  duration_s: { a: number; b: number };
  /** "improved" | "regressed" | "unchanged" */
  status: "improved" | "regressed" | "unchanged";
}

/** Agent runner interface */
export interface AgentRunner {
  /** Run a single task and return the model patch */
  run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult>;
}

/** Result from an agent run (before evaluation) */
export interface AgentRunResult {
  model_patch: string;
  tokens: number;
  duration_s: number;
  cost_usd: number;
  sub_agents?: number;
  merge_failures?: number;
  error?: string;
}
