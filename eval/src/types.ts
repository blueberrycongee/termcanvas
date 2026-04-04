export type AgentMode = "single-claude" | "single-codex" | "hydra";

export interface ModelConfig {
  claude_model: string;
  codex_model?: string;
  hydra_orchestrator_model: string;
  hydra_sub_claude_model: string;
  hydra_sub_codex_model?: string;
}

export const DEFAULT_MODELS: ModelConfig = {
  claude_model: "sonnet",
  codex_model: undefined,
  hydra_orchestrator_model: "sonnet", // NOT haiku — orchestrator needs strong reasoning
  hydra_sub_claude_model: "sonnet",
  hydra_sub_codex_model: undefined,
};

export interface EvalConfig {
  run_id: string;
  mode: AgentMode;
  models: ModelConfig;
  sub_agent_types?: string[];
  prompt_version: string;
  benchmark: string;
  task_filter?: string;
  max_workers?: number;
  timeout_per_task_s?: number;
  run_swebench_eval?: boolean;
}

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

export interface TaskMeta {
  instance_id: string;
  repo: string;
  num_files: number;
  files_changed: string[];
  num_lines: number;
}

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
  eval_detail?: {
    applied: boolean;
    tests_passed: boolean;
    eval_method?: string;
    fail_to_pass_results?: Record<string, boolean>;
  };
}

export interface RunSummary {
  total: number;
  resolved: number;
  pass_rate: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_duration_s: number;
}

export interface RunResult {
  run_id: string;
  config: EvalConfig;
  started_at: string;
  completed_at: string;
  tasks: TaskResult[];
  summary: RunSummary;
}

export interface SWEBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

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

export interface TaskDiff {
  task_id: string;
  pass: { a: boolean; b: boolean };
  tokens: { a: number; b: number };
  duration_s: { a: number; b: number };
  status: "improved" | "regressed" | "unchanged";
}

export interface AgentRunner {
  run(
    task: TaskDefinition,
    workDir: string,
    config: EvalConfig,
  ): Promise<AgentRunResult>;
}

export interface AgentRunResult {
  model_patch: string;
  tokens: number;
  duration_s: number;
  cost_usd: number;
  sub_agents?: number;
  merge_failures?: number;
  error?: string;
}
