type SelectAllTargetLike = EventTarget & {
  classList?: { contains(token: string): boolean };
  isContentEditable?: boolean;
  ownerDocument?: {
    createRange?: () => { selectNodeContents(node: unknown): void };
    getSelection?: () => {
      removeAllRanges(): void;
      addRange(range: unknown): void;
    } | null;
  };
  select?: () => void;
  tagName?: string;
};

export type ContextualSelectAllResult = "target" | "terminal" | "ignored";

function toSelectAllTarget(target: EventTarget | null): SelectAllTargetLike | null {
  return target as SelectAllTargetLike | null;
}

export function isXtermHelperTextArea(target: EventTarget | null): boolean {
  return !!toSelectAllTarget(target)?.classList?.contains("xterm-helper-textarea");
}

function isTextInputTarget(target: EventTarget | null): boolean {
  const element = toSelectAllTarget(target);
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea";
}

export function selectAllInTarget(target: EventTarget | null): boolean {
  const element = toSelectAllTarget(target);
  if (!element) {
    return false;
  }

  if (isTextInputTarget(element) && !isXtermHelperTextArea(element)) {
    if (typeof element.select === "function") {
      element.select();
      return true;
    }
    return false;
  }

  if (!element.isContentEditable) {
    return false;
  }

  const range = element.ownerDocument?.createRange?.();
  const selection = element.ownerDocument?.getSelection?.();
  if (!range || !selection) {
    return false;
  }

  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function performContextualSelectAll(
  activeElement: EventTarget | null,
  selectFocusedTerminal: () => boolean,
): ContextualSelectAllResult {
  if (selectAllInTarget(activeElement)) {
    return "target";
  }

  if (isXtermHelperTextArea(activeElement) && selectFocusedTerminal()) {
    return "terminal";
  }

  return "ignored";
}
