export function shouldRefreshHistorySection(
  projectDirs: string[],
  changedProjectDirs: string[],
): boolean {
  if (projectDirs.length === 0 || changedProjectDirs.length === 0) {
    return false;
  }

  const scope = new Set(projectDirs.map((dir) => dir.trim()).filter(Boolean));
  if (scope.size === 0) {
    return false;
  }

  return changedProjectDirs.some((dir) => scope.has(dir.trim()));
}
