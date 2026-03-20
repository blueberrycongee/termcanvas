import { useWorkspaceStore } from "./stores/workspaceStore";

export function updateWindowTitle() {
  const { workspacePath, dirty } = useWorkspaceStore.getState();
  const name = workspacePath
    ? workspacePath.split(/[\\/]/).pop()?.replace(/\.termcanvas$/, "") ??
      "Untitled"
    : "Untitled";
  const title = `${dirty ? "* " : ""}${name} — TermCanvas`;
  void window.termcanvas?.workspace.setTitle(title);
}
