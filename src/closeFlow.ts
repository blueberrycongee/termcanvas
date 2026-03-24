export type CloseAction = "silent-close" | "prompt-save";

export function getCloseAction({
  dirty,
  installUpdateRequested,
}: {
  dirty: boolean;
  installUpdateRequested: boolean;
}): CloseAction {
  if (!dirty || installUpdateRequested) {
    return "silent-close";
  }

  return "prompt-save";
}
