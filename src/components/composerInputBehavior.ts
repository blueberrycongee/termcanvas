import { hasPrimaryModifier } from "../hooks/shortcutTarget.ts";

export interface ComposerKeyEventLike {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

export interface ComposerPassthroughKeyEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target?: {
    selectionStart: number;
    selectionEnd: number;
  } | null;
}

const ARROW_SEQUENCES: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
};

export function shouldSubmitComposerFromKeyEvent(
  event: ComposerKeyEventLike,
): boolean {
  if (event.key !== "Enter") {
    return false;
  }

  if (event.shiftKey) {
    return false;
  }

  return !(event.isComposing || event.nativeEvent?.isComposing);
}

export function getComposerPassthroughSequence(
  event: ComposerPassthroughKeyEventLike,
  draft: string,
  hasImages: boolean,
  platform: "darwin" | "win32" | "linux" = "darwin",
): string | null {
  if (event.key === "Tab" && event.shiftKey) return "\x1b[Z";
  if (event.key === "Escape") return "\x1b";

  if (event.key === "c" && event.ctrlKey && !event.metaKey) {
    const selectionStart = event.target?.selectionStart;
    const selectionEnd = event.target?.selectionEnd;
    if (selectionStart === undefined || selectionStart === selectionEnd) {
      return "\x03";
    }
  }

  if (event.key === "Enter" && !event.shiftKey && draft.trim().length === 0 && !hasImages) {
    return "\r";
  }

  if (event.key === "Backspace" && draft.length === 0 && !hasImages) {
    return "\x7f";
  }

  const arrowSeq = ARROW_SEQUENCES[event.key];
  if (arrowSeq && (hasPrimaryModifier(event, platform) || draft.trim().length === 0)) {
    return arrowSeq;
  }

  return null;
}
