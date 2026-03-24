function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return (
    tag === "textarea" ||
    tag === "input" ||
    tag === "select" ||
    element.isContentEditable
  );
}

export function hasPrimaryModifier(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  platform: string = window.termcanvas?.app.platform ?? "darwin",
): boolean {
  return platform === "darwin" ? e.metaKey : e.ctrlKey;
}

export function shouldIgnoreShortcutTarget(
  e: Pick<KeyboardEvent, "target" | "metaKey" | "ctrlKey">,
): boolean {
  return isEditableTarget(e.target) && !hasPrimaryModifier(e);
}

export function consumeShortcutEvent(
  e: Pick<KeyboardEvent, "preventDefault" | "stopPropagation"> & {
    stopImmediatePropagation?: () => void;
  },
) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
}
