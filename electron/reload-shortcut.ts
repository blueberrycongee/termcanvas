type ReloadInputLike = Pick<
  Electron.Input,
  "type" | "key" | "meta" | "control" | "alt"
>;

export function isReloadShortcutInput(
  input: ReloadInputLike,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== "keyDown") {
    return false;
  }

  if (input.alt) {
    return false;
  }

  if (input.key.toLowerCase() !== "r") {
    return false;
  }

  if (platform === "darwin") {
    return input.meta && !input.control;
  }

  return input.control && !input.meta;
}
