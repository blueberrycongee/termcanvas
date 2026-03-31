import type { CommandHandler } from "../server.ts";

const goto: CommandHandler = async (page, args) => {
  const url = args[0];
  if (!url) return { ok: false, output: "", error: "usage: goto <url>" };

  const allowed =
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://");
  if (!allowed) return { ok: false, output: "", error: "URL must be http(s):// or file://" };

  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  const status = response?.status() ?? "unknown";
  return { ok: true, output: `Navigated to ${page.url()}\nTitle: ${title}\nStatus: ${status}` };
};

const back: CommandHandler = async (page) => {
  const response = await page.goBack({ waitUntil: "domcontentloaded" });
  if (!response) {
    return { ok: false, output: "", error: "no previous page in history" };
  }
  const title = await page.title();
  return { ok: true, output: `Back to ${page.url()}\nTitle: ${title}` };
};

const reload: CommandHandler = async (page) => {
  await page.reload({ waitUntil: "domcontentloaded" });
  const title = await page.title();
  return { ok: true, output: `Reloaded ${page.url()}\nTitle: ${title}` };
};

const wait: CommandHandler = async (page, args) => {
  const target = args[0];
  if (!target) return { ok: false, output: "", error: "usage: wait <selector|--idle|--load>" };

  if (target === "--idle") {
    await page.waitForLoadState("networkidle");
    return { ok: true, output: "Network idle" };
  }
  if (target === "--load") {
    await page.waitForLoadState("load");
    return { ok: true, output: "Page loaded" };
  }

  await page.waitForSelector(target, { timeout: 10000 });
  return { ok: true, output: `Element found: ${target}` };
};

const url: CommandHandler = async (page) => {
  return { ok: true, output: page.url() };
};

export const navigationCommands = new Map<string, CommandHandler>([
  ["goto", goto],
  ["back", back],
  ["reload", reload],
  ["wait", wait],
  ["url", url],
]);
