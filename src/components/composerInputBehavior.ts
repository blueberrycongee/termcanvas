export interface ComposerKeyEventLike {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
}

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
