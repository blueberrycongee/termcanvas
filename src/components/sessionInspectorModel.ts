import type { TelemetryEvent } from "../../shared/telemetry";
import type { CanvasTerminalItem, CanvasTerminalSections } from "./sessionPanelModel";

export type InspectorTraceTone = "neutral" | "warning" | "success" | "danger";

export type InspectorTraceKind =
  | "session_attached"
  | "session_attach_failed"
  | "running_tool"
  | "using_tool"
  | "thinking"
  | "responding"
  | "turn_complete"
  | "turn_aborted"
  | "process_exited";

export interface InspectorTraceItem {
  id: string;
  at: string;
  kind: InspectorTraceKind;
  tone: InspectorTraceTone;
  toolName?: string;
  exitCode?: number;
}

function summarizeToolName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";

  const tokens = normalized.split(/\s+/);
  const primary = tokens[0]?.split("/").pop() ?? normalized;
  if (primary === "node" && tokens[1]) {
    const child = tokens[1].split("/").pop() ?? tokens[1];
    if (child === "npm" || child === "npx") return child;
    if (child.endsWith(".js")) return child.replace(/\.js$/, "");
    return child;
  }
  return primary;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function mapTraceEvent(event: TelemetryEvent): InspectorTraceItem | null {
  switch (event.kind) {
    case "session_attached":
      return {
        id: event.id,
        at: event.at,
        kind: "session_attached",
        tone: "success",
      };
    case "session_attach_failed":
      return {
        id: event.id,
        at: event.at,
        kind: "session_attach_failed",
        tone: "danger",
      };
    case "foreground_tool_changed": {
      const toolName = summarizeToolName(asString(event.data.to) ?? "");
      if (!toolName) return null;
      return {
        id: event.id,
        at: event.at,
        kind: "using_tool",
        tone: "warning",
        toolName,
      };
    }
    case "session_turn_state_changed": {
      const to = asString(event.data.to);
      if (to === "tool_running" || to === "tool_pending") {
        return {
          id: event.id,
          at: event.at,
          kind: "running_tool",
          tone: "warning",
        };
      }
      if (to === "thinking") {
        return {
          id: event.id,
          at: event.at,
          kind: "thinking",
          tone: "neutral",
        };
      }
      if (to === "in_turn") {
        return {
          id: event.id,
          at: event.at,
          kind: "responding",
          tone: "neutral",
        };
      }
      if (to === "turn_complete") {
        return {
          id: event.id,
          at: event.at,
          kind: "turn_complete",
          tone: "success",
        };
      }
      if (to === "turn_aborted") {
        return {
          id: event.id,
          at: event.at,
          kind: "turn_aborted",
          tone: "danger",
        };
      }
      return null;
    }
    case "session_event": {
      const eventType = asString(event.data.event_type);
      if (
        eventType === "tool_use" ||
        eventType === "function_call" ||
        eventType === "custom_tool_call"
      ) {
        const toolName = summarizeToolName(asString(event.data.tool_name) ?? "");
        if (!toolName) return null;
        return {
          id: event.id,
          at: event.at,
          kind: "using_tool",
          tone: "warning",
          toolName,
        };
      }
      if (eventType === "thinking" || eventType === "reasoning") {
        return {
          id: event.id,
          at: event.at,
          kind: "thinking",
          tone: "neutral",
        };
      }
      if (eventType === "assistant_message" || eventType === "agent_message") {
        return {
          id: event.id,
          at: event.at,
          kind: "responding",
          tone: "neutral",
        };
      }
      if (eventType === "turn_complete" || eventType === "task_complete") {
        return {
          id: event.id,
          at: event.at,
          kind: "turn_complete",
          tone: "success",
        };
      }
      if (eventType === "turn_aborted") {
        return {
          id: event.id,
          at: event.at,
          kind: "turn_aborted",
          tone: "danger",
        };
      }
      return null;
    }
    case "pty_exit": {
      const exitCode = asNumber(event.data.exit_code);
      return {
        id: event.id,
        at: event.at,
        kind: "process_exited",
        tone: exitCode && exitCode !== 0 ? "danger" : "neutral",
        exitCode,
      };
    }
    default:
      return null;
  }
}

export function buildInspectorTrace(events: TelemetryEvent[]): InspectorTraceItem[] {
  const deduped: InspectorTraceItem[] = [];

  for (const event of events) {
    const mapped = mapTraceEvent(event);
    if (!mapped) continue;

    const previous = deduped.at(-1);
    if (
      previous &&
      previous.kind === mapped.kind &&
      previous.toolName === mapped.toolName
    ) {
      deduped[deduped.length - 1] = mapped;
      continue;
    }

    deduped.push(mapped);
  }

  return deduped.slice(-5).reverse();
}

export function pickInspectedTerminal(
  sections: CanvasTerminalSections,
): CanvasTerminalItem | null {
  return (
    sections.focused ??
    sections.attention[0] ??
    sections.progress[0] ??
    sections.done[0] ??
    sections.idle[0] ??
    null
  );
}
