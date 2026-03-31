import type { ServerEventBus, ServerEvent, ServerEventType } from "./event-bus.ts";
import {
  NotificationTransport,
  type JsonNotificationSender,
} from "./notification-transport.ts";

interface WebhookServiceConfig {
  url: string;
  secret?: string;
  eventBus: ServerEventBus;
  sender?: JsonNotificationSender;
}

const LIFECYCLE_EVENTS: ServerEventType[] = [
  "terminal_created",
  "terminal_destroyed",
  "workflow_started",
  "workflow_completed",
  "workflow_failed",
  "server_started",
  "server_stopping",
];

export class WebhookService {
  private readonly url: string;
  private readonly eventBus: ServerEventBus;
  private readonly sender: JsonNotificationSender;
  private readonly listener: (event: ServerEvent) => void;

  constructor(config: WebhookServiceConfig) {
    this.url = config.url;
    this.eventBus = config.eventBus;
    this.sender =
      config.sender ?? new NotificationTransport({ secret: config.secret });

    this.listener = (event: ServerEvent) => {
      if (LIFECYCLE_EVENTS.includes(event.type)) {
        try {
          this.sender.sendJson({
            url: this.url,
            label: `webhook:${event.type}`,
            payload: {
              event: event.type,
              timestamp: event.timestamp,
              payload: event.payload,
            },
          });
        } catch (error) {
          console.error(
            `[webhook] failed to queue ${event.type}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    };

    this.eventBus.on("*", this.listener);
  }

  stop(): void {
    this.eventBus.off("*", this.listener);
    this.sender.stop();
  }
}
