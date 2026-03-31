import type { CommandHandler } from "../server.ts";
import { takeSnapshot } from "../snapshot.ts";

const snapshot: CommandHandler = async (page, args, context) => {
  const interactiveOnly = args.includes("-i");
  const { text, refs } = await takeSnapshot(page, interactiveOnly);

  // Store refs in context for interaction commands
  context.refMap.clear();
  for (const [key, value] of refs) {
    context.refMap.set(key, value);
  }

  return { ok: true, output: text };
};

const text: CommandHandler = async (page) => {
  const content = await page.evaluate(() => {
    // Remove script and style elements before extracting text
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll("script, style")) el.remove();
    return clone.innerText || clone.textContent || "";
  });
  return { ok: true, output: content.trim() };
};

const links: CommandHandler = async (page) => {
  const items = await page.$$eval("a[href]", (anchors) =>
    anchors.map((a) => ({
      text: (a as HTMLAnchorElement).innerText.trim().slice(0, 80),
      href: (a as HTMLAnchorElement).href,
    })),
  );
  if (items.length === 0) return { ok: true, output: "(no links found)" };
  const output = items
    .map((l) => `${l.text || "(no text)"} → ${l.href}`)
    .join("\n");
  return { ok: true, output };
};

const consoleCmd: CommandHandler = async (_page, _args, context) => {
  if (context.consoleMessages.length === 0) {
    return { ok: true, output: "(no console messages)" };
  }
  const recent = context.consoleMessages.slice(-50);
  return { ok: true, output: recent.join("\n") };
};

export const inspectCommands = new Map<string, CommandHandler>([
  ["snapshot", snapshot],
  ["text", text],
  ["links", links],
  ["console", consoleCmd],
]);
