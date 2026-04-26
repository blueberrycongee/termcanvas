import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";

export function useTaskPreloader() {
  const projectCount = useProjectStore((s) => s.projects.length);

  useEffect(() => {
    if (!window.termcanvas || projectCount === 0) return;

    const { projects } = useProjectStore.getState();
    const { setTasks } = useTaskStore.getState();

    for (const project of projects) {
      window.termcanvas.tasks
        .list(project.path)
        .then((tasks) => setTasks(project.path, tasks))
        .catch(() => {});
    }
  }, [projectCount]);
}
