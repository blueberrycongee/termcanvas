import type { Page, Locator } from "playwright";
import type { CommandHandler, BrowseContext } from "../server.ts";

function resolveTarget(
  page: Page,
  target: string,
  context: BrowseContext,
): Locator {
  if (target.startsWith("@e")) {
    const ref = context.refMap.get(target);
    if (!ref) throw new Error(`unknown ref: ${target} (run snapshot first)`);
    return page
      .getByRole(ref.role as any, { name: ref.name, exact: true })
      .nth(ref.index);
  }
  return page.locator(target);
}

const click: CommandHandler = async (page, args, context) => {
  const target = args[0];
  if (!target) return { ok: false, output: "", error: "usage: click <selector|@ref>" };

  const locator = resolveTarget(page, target, context);
  await locator.click();
  return { ok: true, output: `Clicked ${target}` };
};

const fill: CommandHandler = async (page, args, context) => {
  const target = args[0];
  const value = args.slice(1).join(" ");
  if (!target) return { ok: false, output: "", error: "usage: fill <selector|@ref> <value>" };

  const locator = resolveTarget(page, target, context);
  await locator.fill(value);
  return { ok: true, output: `Filled ${target} with "${value}"` };
};

const select: CommandHandler = async (page, args, context) => {
  const target = args[0];
  const value = args[1];
  if (!target || !value)
    return { ok: false, output: "", error: "usage: select <selector|@ref> <value>" };

  const locator = resolveTarget(page, target, context);
  await locator.selectOption(value);
  return { ok: true, output: `Selected "${value}" in ${target}` };
};

const scroll: CommandHandler = async (page, args, context) => {
  const target = args[0];
  if (!target || target === "bottom") {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    return { ok: true, output: "Scrolled to bottom" };
  }
  const locator = resolveTarget(page, target, context);
  await locator.scrollIntoViewIfNeeded();
  return { ok: true, output: `Scrolled to ${target}` };
};

const press: CommandHandler = async (page, args) => {
  const key = args[0];
  if (!key) return { ok: false, output: "", error: "usage: press <key>" };

  await page.keyboard.press(key);
  return { ok: true, output: `Pressed ${key}` };
};

const hover: CommandHandler = async (page, args, context) => {
  const target = args[0];
  if (!target) return { ok: false, output: "", error: "usage: hover <selector|@ref>" };

  const locator = resolveTarget(page, target, context);
  await locator.hover();
  return { ok: true, output: `Hovered ${target}` };
};

export const interactCommands = new Map<string, CommandHandler>([
  ["click", click],
  ["fill", fill],
  ["select", select],
  ["scroll", scroll],
  ["press", press],
  ["hover", hover],
]);
