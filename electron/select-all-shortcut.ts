type SelectAllInputLike = Pick<
  Electron.Input,
  "type" | "key" | "meta" | "control" | "alt" | "shift"
>;

export function isSelectAllShortcutInput(
  input: SelectAllInputLike,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== "keyDown") {
    return false;
  }

  if (input.alt || input.shift) {
    return false;
  }

  if (input.key.toLowerCase() !== "a") {
    return false;
  }

  if (platform === "darwin") {
    return input.meta && !input.control;
  }

  return input.control && !input.meta;
}
