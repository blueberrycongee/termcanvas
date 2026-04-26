import path from "node:path";

export function resolveCanvasProjectRoot(
  inputPath: string,
  projects: Array<{ path: string; worktrees: Array<{ path: string }> }>,
): string {
  const resolved = path.resolve(inputPath);
  for (const project of projects) {
    if (path.resolve(project.path) === resolved) {
      return project.path;
    }
    for (const wt of project.worktrees) {
      if (path.resolve(wt.path) === resolved) {
        return project.path;
      }
    }
  }
  throw Object.assign(
    new Error(
      "This repo is not on the TermCanvas canvas. Add it as a project first.",
    ),
    { status: 400 },
  );
}
