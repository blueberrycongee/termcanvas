const TERMINAL_CUSTOM_TITLE_INTERACTION_SELECTOR =
  "[data-terminal-custom-title-interaction]";

type ClosestCapableTarget = EventTarget & {
  closest?: (selector: string) => unknown;
};

export function shouldSkipTerminalTileFocus(target: EventTarget | null) {
  const closest = (target as ClosestCapableTarget | null)?.closest;
  if (typeof closest !== "function") {
    return false;
  }

  return Boolean(closest(TERMINAL_CUSTOM_TITLE_INTERACTION_SELECTOR));
}
