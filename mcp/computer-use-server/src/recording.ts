import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface RecordingState {
  enabled: boolean;
  output_dir: string | null;
  next_turn: number;
}

export interface RecordedAction {
  schema_version: "termcanvas/computer-use-action/v1";
  turn: number;
  recorded_at: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: {
    is_error: boolean;
    content: Array<Record<string, unknown>>;
  };
}

let state: {
  enabled: boolean;
  outputDir: string | null;
  nextTurn: number;
  startedAt: string | null;
} = {
  enabled: false,
  outputDir: null,
  nextTurn: 1,
  startedAt: null,
};

const RECORDABLE_TOOLS = new Set([
  "set_config",
  "open_app",
  "launch_app",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "move_cursor",
  "type_text",
  "type_text_chars",
  "press_key",
  "hotkey",
  "set_value",
  "perform_secondary_action",
  "scroll",
  "drag",
]);

export function canonicalToolName(name: string): string {
  return name.startsWith("computer_use_")
    ? name.slice("computer_use_".length)
    : name;
}

export function isRecordableTool(name: string): boolean {
  return RECORDABLE_TOOLS.has(canonicalToolName(name));
}

export function getRecordingState(): RecordingState {
  return {
    enabled: state.enabled,
    output_dir: state.outputDir,
    next_turn: state.nextTurn,
  };
}

export function setRecording(args: Record<string, unknown>): RecordingState {
  if (typeof args.enabled !== "boolean") {
    throw new Error("set_recording requires enabled: boolean.");
  }
  if (args.video_experimental === true) {
    throw new Error(
      "video_experimental recording is not supported by TermCanvas Computer Use yet.",
    );
  }

  if (!args.enabled) {
    if (state.outputDir) {
      writeSessionFile({ stopped_at: new Date().toISOString() });
    }
    state = {
      ...state,
      enabled: false,
    };
    return getRecordingState();
  }

  if (typeof args.output_dir !== "string" || args.output_dir.trim() === "") {
    throw new Error("output_dir is required when enabling recording.");
  }

  const outputDir = expandHome(args.output_dir.trim());
  fs.mkdirSync(outputDir, { recursive: true });
  state = {
    enabled: true,
    outputDir,
    nextTurn: 1,
    startedAt: new Date().toISOString(),
  };
  writeSessionFile();
  return getRecordingState();
}

export function recordToolCall(
  name: string,
  args: Record<string, unknown>,
  result: CallToolResult,
): void {
  if (!state.enabled || !state.outputDir || !isRecordableTool(name)) {
    return;
  }

  const turn = state.nextTurn;
  state.nextTurn += 1;
  writeSessionFile();

  const turnDir = path.join(state.outputDir, `turn-${String(turn).padStart(6, "0")}`);
  fs.mkdirSync(turnDir, { recursive: true });

  const action: RecordedAction = {
    schema_version: "termcanvas/computer-use-action/v1",
    turn,
    recorded_at: new Date().toISOString(),
    tool: canonicalToolName(name),
    arguments: structuredCloneJson(args),
    result: {
      is_error: result.isError === true,
      content: result.content.map((item) => {
        if (item.type === "text") {
          return { type: "text", text: item.text };
        }
        if (item.type === "image") {
          return { type: "image", mimeType: item.mimeType };
        }
        return { type: item.type };
      }),
    },
  };

  writeJsonAtomic(path.join(turnDir, "action.json"), action);
}

export function loadRecordedActions(inputDir: string): RecordedAction[] {
  const dir = expandHome(inputDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^turn-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return entries.map((entry) => {
    const file = path.join(dir, entry, "action.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
    if (!isRecordedAction(raw)) {
      throw new Error(`Invalid recorded action: ${file}`);
    }
    return raw;
  });
}

function writeSessionFile(extra: Record<string, unknown> = {}): void {
  if (!state.outputDir) return;
  writeJsonAtomic(path.join(state.outputDir, "session.json"), {
    schema_version: "termcanvas/computer-use-recording/v1",
    started_at: state.startedAt,
    output_dir: state.outputDir,
    enabled: state.enabled,
    next_turn: state.nextTurn,
    ...extra,
  });
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, file);
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function structuredCloneJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecordedAction(value: unknown): value is RecordedAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.schema_version === "termcanvas/computer-use-action/v1" &&
    typeof record.turn === "number" &&
    typeof record.tool === "string" &&
    typeof record.arguments === "object" &&
    record.arguments !== null &&
    !Array.isArray(record.arguments);
}
