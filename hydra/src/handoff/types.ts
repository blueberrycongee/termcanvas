/**
 * Hydra Handoff System - Type Definitions
 *
 * Based on Anthropic's file-based agent communication pattern
 */

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
  | "in_progress" // 正在处理
  | "completed"  // 已完成
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

export interface Handoff {
  // 元信息
  id: string;
  created_at: string;
  workflow_id: string;

  // 路由
  from: AgentInfo;
  to: AgentInfo;

  // 任务
  task: TaskDefinition;

  // 上下文
  context: HandoffContext;

  // 控制
  status: HandoffStatus;
  timeout_minutes?: number;
  retry_count: number;
  max_retries: number;

  // 结果（完成后填充）
  result?: {
    success: boolean;
    output_files?: string[];
    message?: string;
    completed_at?: string;
  };
}
