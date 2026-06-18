// Blocking-event types shared between main process and renderer.
//
// A "blocking event" is something that has paused agent progress and
// requires the user to act in the terminal (approve a tool call, answer
// an elicitation prompt). Currently kind=approval is the only producer;
// the shape is event-bus-style so future producers (decision points,
// quota, auth) can plug in without churn.

export type BlockingEventKind = "approval";

export interface BlockingEvent {
  // Stable per (terminalId + kind) — used to dedupe and to close the
  // OS notification when the block is resolved.
  id: string;
  kind: BlockingEventKind;
  terminalId: string;
  // Best-effort context for the notification body. Filled by the main
  // process from telemetry; renderer treats them as opaque labels.
  projectName?: string;
  terminalTitle?: string;
  createdAt: number;
}

export interface BlockingEventResolved {
  id: string;
  terminalId: string;
  resolvedAt: number;
}
