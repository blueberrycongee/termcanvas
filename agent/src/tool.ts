/**
 * Tool interface and executor for the orchestration agent.
 *
 * Tools are partitioned by read-only safety:
 *  - read-only tools run concurrently
 *  - mutating tools run serially
 */

import type { z, ZodObject, ZodRawShape } from "zod";
import type { ToolResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

export interface Tool<S extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: ZodObject<S>;

  /** Execute the tool. */
  call(input: z.infer<ZodObject<S>>, signal?: AbortSignal): Promise<ToolResult>;

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

export async function executeTools(
  calls: ToolCall[],
  registry: ToolRegistry,
  signal?: AbortSignal,
  onStart?: (name: string, input: Record<string, unknown>) => void,
  onEnd?: (name: string, result: ToolResult) => void,
): Promise<ToolCallResult[]> {
  // Partition into batches: consecutive read-only calls form one concurrent batch,
  // each non-read-only call is its own serial batch.
  const batches = partitionCalls(calls, registry);
  const results: ToolCallResult[] = [];

  for (const batch of batches) {
    if (batch.concurrent) {
      const batchResults = await Promise.all(
        batch.calls.map((call) => executeSingle(call, registry, signal, onStart, onEnd)),
      );
      results.push(...batchResults);
    } else {
      for (const call of batch.calls) {
        results.push(await executeSingle(call, registry, signal, onStart, onEnd));
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
): Promise<ToolCallResult> {
  const tool = registry.get(call.name);
  if (!tool) {
    return {
      tool_use_id: call.id,
      content: `Unknown tool: ${call.name}`,
      is_error: true,
    };
  }

  onStart?.(call.name, call.input);

  try {
    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      const result: ToolResult = {
        content: `Invalid input: ${parsed.error.message}`,
        is_error: true,
      };
      onEnd?.(call.name, result);
      return { tool_use_id: call.id, ...result };
    }

    const result = await tool.call(parsed.data, signal);
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
