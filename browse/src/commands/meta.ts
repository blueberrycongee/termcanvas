import type { CommandHandler } from "../server.ts";

const screenshot: CommandHandler = async (page, args) => {
  const filePath = args[0] || "screenshot.png";
  await page.screenshot({ path: filePath, fullPage: false });
  return { ok: true, output: `Screenshot saved to ${filePath}` };
};

const tabs: CommandHandler = async (_page, _args, context) => {
  const pages = context.browser.contexts()[0]?.pages() ?? [];
  if (pages.length === 0) return { ok: true, output: "(no tabs)" };

  const lines = pages.map(
    (p, i) => `${i}: ${p.url()} — ${p === context.page ? "(active)" : ""}`,
  );
  return { ok: true, output: lines.join("\n") };
};

const tab: CommandHandler = async (_page, args, context) => {
  const index = parseInt(args[0], 10);
  if (isNaN(index))
    return { ok: false, output: "", error: "usage: tab <index>" };

  const pages = context.browser.contexts()[0]?.pages() ?? [];
  if (index < 0 || index >= pages.length)
    return { ok: false, output: "", error: `tab index out of range (0-${pages.length - 1})` };

  const target = pages[index];
  await target.bringToFront();
  context.setPage(target);
  return { ok: true, output: `Switched to tab ${index}: ${target.url()}` };
};

const cookies: CommandHandler = async (_page, _args, context) => {
  const browserContext = context.browser.contexts()[0];
  if (!browserContext) return { ok: true, output: "[]" };
  const allCookies = await browserContext.cookies();
  return { ok: true, output: JSON.stringify(allCookies, null, 2) };
};

const status: CommandHandler = async () => {
  return { ok: true, output: `browse server running (pid ${process.pid})` };
};

export const metaCommands = new Map<string, CommandHandler>([
  ["screenshot", screenshot],
  ["tabs", tabs],
  ["tab", tab],
  ["cookies", cookies],
  ["status", status],
]);
