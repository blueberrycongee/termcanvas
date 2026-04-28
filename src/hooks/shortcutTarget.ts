export function isEditableTarget(target: EventTarget | null): boolean {
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

function targetHasClass(target: unknown, className: string): boolean {
  const element = target as { classList?: { contains?: (token: string) => boolean } };
  return element.classList?.contains?.(className) === true;
}

export function isTerminalShortcutTarget(target: EventTarget | null): boolean {
  let element = target as
    | ({ parentElement?: unknown; parentNode?: unknown } & EventTarget)
    | null;

  while (element) {
    if (
      targetHasClass(element, "xterm-helper-textarea") ||
      targetHasClass(element, "tc-xterm-host")
    ) {
      return true;
    }
    element = (element.parentElement ?? element.parentNode ?? null) as
      | ({ parentElement?: unknown; parentNode?: unknown } & EventTarget)
      | null;
  }

  return false;
}

// Elements that natively activate on Space / Enter. Stealing these
// keys for app shortcuts would silently break keyboard operation of
// the focused control.
export function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.matches(
    'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="radio"], [role="tab"], [role="switch"]',
  );
}

export function hasPrimaryModifier(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  platform: string = window.termcanvas?.app.platform ?? "darwin",
): boolean {
  return platform === "darwin" ? e.metaKey : e.ctrlKey;
}

export function shouldIgnoreShortcutTarget(
  e: Pick<KeyboardEvent, "target" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return isEditableTarget(e.target) && !hasPrimaryModifier(e) && !e.altKey;
}
