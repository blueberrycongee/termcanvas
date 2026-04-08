import type { TerminalTelemetrySnapshot } from "../../shared/telemetry";

const BADGE_LABELS: Record<NonNullable<TerminalTelemetrySnapshot["derived_status"]>, string> = {
  idle: "Idle",
  starting: "Starting",
  progressing: "Progressing",
  awaiting_contract: "Awaiting contract",
  stall_candidate: "Stall candidate",
  error: "API error",
  exited: "Process exited",
};

export function formatTelemetryAge(
  timestamp: string | undefined,
  nowMs = Date.now(),
): string {
  if (!timestamp) return "unknown";
  const deltaMs = Math.max(0, nowMs - new Date(timestamp).getTime());
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getTelemetryBadgeLabel(
  snapshot: TerminalTelemetrySnapshot | null | undefined,
): string | null {
  if (!snapshot) return null;
  return BADGE_LABELS[snapshot.derived_status];
}

export function getTelemetryFacts(
  snapshot: TerminalTelemetrySnapshot | null | undefined,
  nowMs = Date.now(),
): string[] {
  if (!snapshot) return [];

  const sessionFact = snapshot.session_attached
    ? snapshot.pty_alive
      ? "Session attached"
      : "Session recorded"
    : "Session pending";

  const processFact = snapshot.pty_alive
    ? null
    : snapshot.exit_code === undefined
      ? "Process exited"
      : `Process exited (${snapshot.exit_code})`;

  const facts = [
    `Provider ${snapshot.provider}`,
    processFact,
    sessionFact,
    `Progress ${formatTelemetryAge(snapshot.last_meaningful_progress_at, nowMs)}`,
    snapshot.last_session_event_kind
      ? `Event ${snapshot.last_session_event_kind}`
      : "Event unknown",
    snapshot.foreground_tool ? `Tool ${snapshot.foreground_tool}` : null,
    snapshot.result_exists
      ? "Contract result"
      : "Contract pending",
  ];

  return facts.filter((fact): fact is string => Boolean(fact));
}
