import { useEffect } from "react";
import { Canvas } from "./canvas/Canvas";
import { Toolbar } from "./toolbar/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { NotificationToast } from "./components/NotificationToast";
import { useProjectStore } from "./stores/projectStore";

function useWorktreeWatcher() {
  const { projects, syncWorktrees } = useProjectStore();

  useEffect(() => {
    if (!window.termcanvas) return;

    // Start watching all projects
    for (const p of projects) {
      window.termcanvas.project.watch(p.path);
    }

    // Listen for worktree changes
    const unsubscribe = window.termcanvas.project.onWorktreesChanged(
      (dirPath, worktrees) => {
        syncWorktrees(dirPath, worktrees);
      },
    );

    return () => {
      unsubscribe();
      for (const p of projects) {
        window.termcanvas.project.unwatch(p.path);
      }
    };
  }, [projects.length]); // Re-subscribe when projects are added/removed
}

export function App() {
  useWorktreeWatcher();

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      <Toolbar />
      <Sidebar />
      <Canvas />
      <NotificationToast />
    </div>
  );
}
