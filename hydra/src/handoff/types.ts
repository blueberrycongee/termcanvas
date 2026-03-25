/**
 * Hydra Handoff System - Type Definitions
 *
 * Based on Anthropic's file-based agent communication pattern
 */

import type { TaskPackagePaths } from "../protocol.ts";

export type AgentRole =
  | "planner"
  | "implementer"
  | "evaluator"
  | "reviewer"
  | "integrator"
  | "researcher";

export type AgentType = "claude" | "codex" | "kimi" | "gemini";

export type HandoffStatus =
  | "pending"    // 等待处理
  | "claimed"    // 已被某个 tick 占位，避免重复派发
  | "in_progress" // 正在处理
  | "completed"  // 已完成
  | "timed_out"  // 超时，可重试
  | "failed";    // 失败

export interface AgentInfo {
  role: AgentRole;
  agent_type: AgentType;
  agent_id: string | null; // null = 待分配
}

export interface TaskDefinition {
  type: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  constraints?: Record<string, any>;
}

export interface HandoffContext {
  files: string[];
  previous_handoffs: string[];
  decisions?: Record<string, string>;
  shared_state?: Record<string, any>;
}

export interface HandoffClaim {
  tick_id: string;
  claimed_at: string;
}

export interface HandoffTransition {
  event:
    | "claim_pending"
    | "mark_in_progress"
    | "mark_completed"
    | "mark_failed"
    | "mark_timed_out"
    | "schedule_retry"
    | "retry_exhausted"
    | "manual_retry";
  from: HandoffStatus;
  to: HandoffStatus;
  at: string;
  tick_id?: string;
  agent_id?: string;
}

export interface HandoffError {
  code: string;
  message: string;
  stage: string;
  retryable: boolean;
  at: string;
}

export interface HandoffDispatchAttempt {
  attempt: number;
  terminal_id: string;
  agent_type: AgentType;
  prompt: string;
  started_at: string;
  retry_of?: string;
  timed_out_at?: string;
  completed_at?: string;
  failed_at?: string;
}

export interface HandoffDispatchState {
  active_terminal_id: string | null;
  attempts: HandoffDispatchAttempt[];
}

export interface Handoff {
  // 元信息
  id: string;
  created_at: string;
  workflow_id: string;
  workspace_root?: string;
  worktree_path?: string;

  // 路由
  from: AgentInfo;
  to: AgentInfo;

  // 任务
  task: TaskDefinition;

  // 上下文
  context: HandoffContext;
  artifacts?: TaskPackagePaths;

  // 控制
  status: HandoffStatus;
  status_updated_at?: string;
  timeout_minutes?: number;
  retry_count: number;
  max_retries: number;
  claim?: HandoffClaim;
  transitions?: HandoffTransition[];
  last_error?: HandoffError;
  dispatch?: HandoffDispatchState;

  // 结果（完成后填充）
  result?: {
    success: boolean;
    summary?: string;
    outputs?: Array<{
      path: string;
      description: string;
    }>;
    evidence?: string[];
    next_action?: {
      type: "complete" | "retry" | "handoff";
      reason: string;
      handoff_id?: string;
    };
    output_files?: string[];
    message?: string;
    completed_at?: string;
  };
}
