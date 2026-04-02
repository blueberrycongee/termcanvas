/**
 * Tool interface and executor for the orchestration agent.
 *
 * Tools are partitioned by read-only safety:
 *  - read-only tools run concurrently
 *  - mutating tools run serially
 */

import type { z, ZodObject, ZodRawShape } from "zod";
import type { ToolResult, ToolCallReturn, PendingToolResult } from "./types.ts";
import type { ToolHooks } from "./tool-hooks.ts";
import { runPreHooks, runPostHooks } from "./tool-hooks.ts";

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

export interface Tool<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: ZodObject<S>;

  /** Execute the tool. May return a pending result for background execution. */
  call(input: z.infer<ZodObject<S>>, signal?: AbortSignal): Promise<ToolCallReturn>;

  /** Can this tool run in parallel with other read-only tools? */
  isReadOnly: boolean;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  /** Convert all tools to JSON Schema for the LLM API. */
  toAPISchemas(): APIToolSchema[] {
    return this.all().map(toolToAPISchema);
  }
}

// ---------------------------------------------------------------------------
// JSON Schema conversion (Zod → API tool definition)
// ---------------------------------------------------------------------------

export interface APIToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function zodToJsonSchema(schema: ZodObject<ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodField = value as z.ZodTypeAny;
    properties[key] = zodFieldToJsonSchema(zodField);
    if (!zodField.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const def = field._def;
  const description = field.description;
  const base: Record<string, unknown> = {};
  if (description) base.description = description;

  // Unwrap optional/nullable
  if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
    return { ...base, ...zodFieldToJsonSchema(def.innerType) };
  }

  // Unwrap default
  if (def.typeName === "ZodDefault") {
    return { ...base, ...zodFieldToJsonSchema(def.innerType) };
  }

  switch (def.typeName) {
    case "ZodString":
      return { ...base, type: "string" };
    case "ZodNumber":
      return { ...base, type: "number" };
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodEnum":
      return { ...base, type: "string", enum: def.values };
    case "ZodArray":
      return {
        ...base,
        type: "array",
        items: zodFieldToJsonSchema(def.type),
      };
    case "ZodObject":
      return { ...base, ...zodToJsonSchema(field as ZodObject<ZodRawShape>) };
    default:
      return { ...base, type: "string" };
  }
}

function toolToAPISchema(tool: Tool): APIToolSchema {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: zodToJsonSchema(tool.inputSchema),
  };
}

// ---------------------------------------------------------------------------
// Tool executor — partitions by read-only safety
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface PendingTask {
  taskId: string;
  toolName: string;
  startTime: number;
  promise: Promise<ToolResult>;
  settled: boolean;
  settledResult?: ToolResult;
}

function isPendingResult(result: ToolCallReturn): result is PendingToolResult {
  return "status" in result && result.status === "pending";
}

export async function executeTools(
  calls: ToolCall[],
  registry: ToolRegistry,
  signal?: AbortSignal,
  onStart?: (name: string, input: Record<string, unknown>) => void,
  onEnd?: (name: string, result: ToolResult) => void,
  pendingTasks?: Map<string, PendingTask>,
  hooks?: ToolHooks,
): Promise<ToolCallResult[]> {
  const batches = partitionCalls(calls, registry);
  const results: ToolCallResult[] = [];

  for (const batch of batches) {
    if (batch.concurrent) {
      const batchResults = await Promise.all(
        batch.calls.map((call) => executeSingle(call, registry, signal, onStart, onEnd, pendingTasks, hooks)),
      );
      results.push(...batchResults);
    } else {
      for (const call of batch.calls) {
        results.push(await executeSingle(call, registry, signal, onStart, onEnd, pendingTasks, hooks));
      }
    }
  }

  return results;
}

async function executeSingle(
  call: ToolCall,
  registry: ToolRegistry,
  signal?: AbortSignal,
  onStart?: (name: string, input: Record<string, unknown>) => void,
  onEnd?: (name: string, result: ToolResult) => void,
  pendingTasks?: Map<string, PendingTask>,
  hooks?: ToolHooks,
): Promise<ToolCallResult> {
  const tool = registry.get(call.name);
  if (!tool) {
    return {
      tool_use_id: call.id,
      content: `Unknown tool: ${call.name}`,
      is_error: true,
    };
  }

  let effectiveInput = call.input;

  if (hooks && hooks.pre.length > 0) {
    const preResult = await runPreHooks(hooks.pre, {
      toolName: call.name,
      input: effectiveInput,
      isReadOnly: tool.isReadOnly,
    });

    if (preResult.blocked || preResult.permission === "deny") {
      const result: ToolResult = {
        content: preResult.message ?? "Tool execution denied by hook",
        is_error: true,
      };
      return { tool_use_id: call.id, ...result };
    }

    if (preResult.permission === "ask") {
      const result: ToolResult = {
        content: `Permission required: ${preResult.message ?? "Tool requires approval"}`,
        is_error: true,
      };
      return { tool_use_id: call.id, ...result };
    }

    effectiveInput = preResult.input;
  }

  onStart?.(call.name, effectiveInput);

  try {
    const parsed = tool.inputSchema.safeParse(effectiveInput);
    if (!parsed.success) {
      const result: ToolResult = {
        content: `Invalid input: ${parsed.error.message}`,
        is_error: true,
      };
      onEnd?.(call.name, result);
      return { tool_use_id: call.id, ...result };
    }

    const callReturn = await tool.call(parsed.data, signal);

    if (isPendingResult(callReturn)) {
      if (pendingTasks) {
        const promise = Promise.resolve({ content: callReturn.content });
        const task: PendingTask = {
          taskId: callReturn.taskId,
          toolName: call.name,
          startTime: Date.now(),
          promise,
          settled: false,
        };
        promise.then((r) => { task.settled = true; task.settledResult = r; });
        pendingTasks.set(callReturn.taskId, task);
      }
      onEnd?.(call.name, { content: callReturn.content });
      return { tool_use_id: call.id, content: callReturn.content };
    }

    let finalOutput = callReturn.content;

    if (hooks && hooks.post.length > 0) {
      const postResult = await runPostHooks(hooks.post, {
        toolName: call.name,
        input: effectiveInput,
        output: finalOutput,
        isReadOnly: tool.isReadOnly,
      });

      if (postResult.blocked) {
        const result: ToolResult = {
          content: postResult.message ?? "Tool output blocked by hook",
          is_error: true,
        };
        onEnd?.(call.name, result);
        return { tool_use_id: call.id, ...result };
      }

      finalOutput = postResult.output;
    }

    const result: ToolResult = { content: finalOutput, is_error: callReturn.is_error };
    onEnd?.(call.name, result);
    return { tool_use_id: call.id, ...result };
  } catch (err) {
    const result: ToolResult = {
      content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
      is_error: true,
    };
    onEnd?.(call.name, result);
    return { tool_use_id: call.id, ...result };
  }
}

interface Batch {
  concurrent: boolean;
  calls: ToolCall[];
}

function partitionCalls(calls: ToolCall[], registry: ToolRegistry): Batch[] {
  const batches: Batch[] = [];
  let readOnlyBuffer: ToolCall[] = [];

  const flushReadOnly = () => {
    if (readOnlyBuffer.length > 0) {
      batches.push({ concurrent: true, calls: readOnlyBuffer });
      readOnlyBuffer = [];
    }
  };

  for (const call of calls) {
    const tool = registry.get(call.name);
    if (tool?.isReadOnly) {
      readOnlyBuffer.push(call);
    } else {
      flushReadOnly();
      batches.push({ concurrent: false, calls: [call] });
    }
  }

  flushReadOnly();
  return batches;
}
