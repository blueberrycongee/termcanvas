/**
 * Composable pre/post tool hooks with permission decisions.
 *
 * Pre-hooks can modify input, return permission decisions, or block execution.
 * Post-hooks can transform output or block continuation.
 * Permission precedence: deny > ask > allow.
 */

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PreHookContext {
  toolName: string;
  input: Record<string, unknown>;
  isReadOnly: boolean;
}

export interface PreHookResult {
  permission?: PermissionDecision;
  updatedInput?: Record<string, unknown>;
  message?: string;
  blocked?: boolean;
}

export interface PostHookContext {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  isReadOnly: boolean;
}

export interface PostHookResult {
  updatedOutput?: string;
  message?: string;
  blocked?: boolean;
}

export type PreHook = (ctx: PreHookContext) => Promise<PreHookResult>;
export type PostHook = (ctx: PostHookContext) => Promise<PostHookResult>;

export interface ToolHooks {
  pre: PreHook[];
  post: PostHook[];
}

export interface PreHookAggregate {
  permission: PermissionDecision;
  input: Record<string, unknown>;
  blocked: boolean;
  message?: string;
}

export async function runPreHooks(
  hooks: PreHook[],
  ctx: PreHookContext,
): Promise<PreHookAggregate> {
  if (hooks.length === 0) {
    return { permission: "allow", input: ctx.input, blocked: false };
  }

  let currentInput = ctx.input;
  let highestPermission: PermissionDecision = "allow";
  let message: string | undefined;

  for (const hook of hooks) {
    let result: PreHookResult;
    try {
      result = await hook({ ...ctx, input: currentInput });
    } catch {
      return { permission: "deny", input: currentInput, blocked: true, message: "Pre-hook threw an error" };
    }

    if (result.blocked) {
      return { permission: "deny", input: currentInput, blocked: true, message: result.message };
    }

    if (result.updatedInput) {
      currentInput = result.updatedInput;
    }

    if (result.permission) {
      highestPermission = mergePermission(highestPermission, result.permission);
    }

    if (result.message) {
      message = result.message;
    }
  }

  return { permission: highestPermission, input: currentInput, blocked: false, message };
}

export interface PostHookAggregate {
  output: string;
  blocked: boolean;
  message?: string;
}

export async function runPostHooks(
  hooks: PostHook[],
  ctx: PostHookContext,
): Promise<PostHookAggregate> {
  if (hooks.length === 0) {
    return { output: ctx.output, blocked: false };
  }

  let currentOutput = ctx.output;
  let message: string | undefined;

  for (const hook of hooks) {
    let result: PostHookResult;
    try {
      result = await hook({ ...ctx, output: currentOutput });
    } catch {
      return { output: currentOutput, blocked: true, message: "Post-hook threw an error" };
    }

    if (result.blocked) {
      return { output: currentOutput, blocked: true, message: result.message };
    }

    if (result.updatedOutput !== undefined) {
      currentOutput = result.updatedOutput;
    }

    if (result.message) {
      message = result.message;
    }
  }

  return { output: currentOutput, blocked: false, message };
}

function mergePermission(current: PermissionDecision, incoming: PermissionDecision): PermissionDecision {
  const PRIORITY: Record<PermissionDecision, number> = { allow: 0, ask: 1, deny: 2 };
  return PRIORITY[incoming] > PRIORITY[current] ? incoming : current;
}
