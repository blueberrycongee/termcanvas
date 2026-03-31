import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import { WebhookService } from "../headless-runtime/webhook.ts";

async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

test("webhook signs payloads with X-Webhook-Signature when secret is configured", async () => {
  const eventBus = new ServerEventBus();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: string }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const service = new WebhookService({
      url: "https://example.com/webhook",
      secret: "very-secret",
      eventBus,
    });

    eventBus.emit("server_started", { host: "127.0.0.1", port: 7080 });
    await flushMicrotasks();

    assert.equal(calls.length, 1);
    const body = calls[0].body;
    const signature = crypto
      .createHmac("sha256", "very-secret")
      .update(body)
      .digest("hex");
    assert.equal(calls[0].headers.get("X-Webhook-Signature"), signature);

    service.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhook retries with 1s, 4s, and 16s delays after the initial failure", async () => {
  const eventBus = new ServerEventBus();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const delays: number[] = [];
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network down");
  }) as typeof fetch;

  globalThis.setTimeout = (((callback: (...args: never[]) => void, delay?: number) => {
    delays.push(Number(delay ?? 0));
    queueMicrotask(() => callback());
    return { delay } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const service = new WebhookService({
      url: "https://example.com/webhook",
      eventBus,
    });

    eventBus.emit("server_started", { host: "127.0.0.1", port: 7080 });
    await flushMicrotasks(12);

    assert.equal(fetchCalls, 4);
    assert.deepEqual(delays, [1_000, 4_000, 16_000]);

    service.stop();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
