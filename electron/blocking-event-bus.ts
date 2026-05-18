import type {
  BlockingEvent,
  BlockingEventKind,
  BlockingEventResolved,
} from "../shared/blocking";

// Suppression / re-trigger thresholds. Inlined rather than imported from
// lifecycleThresholds.ts because they belong to the notification layer,
// not the telemetry derivation layer.
const FAST_DECISION_WINDOW_MS = 1_500;
const SAME_KIND_REPEAT_WINDOW_MS = 5 * 60_000;

type EmitListener = (event: BlockingEvent) => void;
type ResolveListener = (resolved: BlockingEventResolved) => void;

interface PendingEntry {
  event: BlockingEvent;
  // Wall-clock timer that fires the notification 1.5s after `open` —
  // gives the user a chance to dismiss the prompt themselves before we
  // bother the OS. Cleared when the block resolves first.
  notifyTimer: ReturnType<typeof setTimeout> | null;
  // Whether the notification has actually been published. Distinct from
  // "active" because we may have an active block that we deliberately
  // suppressed (window focused, recent re-prompt, etc).
  notified: boolean;
}

export class BlockingEventBus {
  // Active, unresolved blocks — keyed by event id (stable per terminal+kind).
  private readonly active = new Map<string, PendingEntry>();
  // Most recent notification publish time per (terminalId|kind), used for
  // 5-minute repeat suppression. Outlives `active` entries on purpose.
  private readonly lastNotifiedAt = new Map<string, number>();

  private readonly emitListeners = new Set<EmitListener>();
  private readonly resolveListeners = new Set<ResolveListener>();

  // Caller decides — usually `mainWindow.isFocused()`. Pulled at the
  // moment the notify timer fires so a user who refocuses during the
  // 1.5s grace window is still respected.
  constructor(
    private readonly options: {
      isWindowFocused: () => boolean;
      now?: () => number;
    },
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  open(input: {
    kind: BlockingEventKind;
    terminalId: string;
    projectName?: string;
    terminalTitle?: string;
  }): BlockingEvent {
    const id = `${input.terminalId}::${input.kind}`;
    const existing = this.active.get(id);
    if (existing) {
      // Already-open block re-opening — just refresh metadata so the
      // inbox / notification body picks up a renamed terminal, but keep
      // the original createdAt and the existing notify timer.
      existing.event.projectName = input.projectName ?? existing.event.projectName;
      existing.event.terminalTitle =
        input.terminalTitle ?? existing.event.terminalTitle;
      return existing.event;
    }

    const event: BlockingEvent = {
      id,
      kind: input.kind,
      terminalId: input.terminalId,
      projectName: input.projectName,
      terminalTitle: input.terminalTitle,
      createdAt: this.now,
    };

    const entry: PendingEntry = {
      event,
      notifyTimer: null,
      notified: false,
    };

    entry.notifyTimer = setTimeout(() => {
      entry.notifyTimer = null;
      this.maybePublish(entry);
    }, FAST_DECISION_WINDOW_MS);

    this.active.set(id, entry);
    for (const listener of this.emitListeners) listener(event);
    return event;
  }

  resolve(input: { kind: BlockingEventKind; terminalId: string }): void {
    const id = `${input.terminalId}::${input.kind}`;
    const entry = this.active.get(id);
    if (!entry) return;

    if (entry.notifyTimer) {
      clearTimeout(entry.notifyTimer);
      entry.notifyTimer = null;
    }
    this.active.delete(id);

    const resolved: BlockingEventResolved = {
      id,
      terminalId: input.terminalId,
      resolvedAt: this.now,
    };
    for (const listener of this.resolveListeners) listener(resolved);
  }

  // Renderer asks for the snapshot at startup so the toolbar dot picks
  // up blocks that opened before the renderer subscribed.
  list(): BlockingEvent[] {
    return Array.from(this.active.values()).map((e) => e.event);
  }

  onOpen(listener: EmitListener): () => void {
    this.emitListeners.add(listener);
    return () => this.emitListeners.delete(listener);
  }

  onResolve(listener: ResolveListener): () => void {
    this.resolveListeners.add(listener);
    return () => this.resolveListeners.delete(listener);
  }

  // Decide whether to actually fire the OS notification. Suppression
  // rules live here, not at the telemetry call site, so all producers
  // share the same policy.
  private maybePublish(entry: PendingEntry): void {
    if (!this.active.has(entry.event.id)) {
      // Resolved during the grace window — fast-decision suppression.
      return;
    }

    if (this.options.isWindowFocused()) {
      // App is in front; in-app affordances (toolbar dot, future tile
      // pulse) carry the load. Don't redundantly send to OS notif center.
      return;
    }

    const repeatKey = `${entry.event.terminalId}|${entry.event.kind}`;
    const lastAt = this.lastNotifiedAt.get(repeatKey) ?? 0;
    if (this.now - lastAt < SAME_KIND_REPEAT_WINDOW_MS) {
      return;
    }

    this.lastNotifiedAt.set(repeatKey, this.now);
    entry.notified = true;
    for (const listener of this.publishListeners) listener(entry.event);
  }

  // Separate channel from `onOpen`: `onOpen` always fires (renderer
  // needs it for the dot); `onPublish` only fires when suppression
  // actually permits an OS notification.
  private readonly publishListeners = new Set<EmitListener>();
  onPublish(listener: EmitListener): () => void {
    this.publishListeners.add(listener);
    return () => this.publishListeners.delete(listener);
  }
}
