export function toggleExpandedFiles(
  expandedFiles: ReadonlySet<string>,
  fileName: string,
) {
  const next = new Set(expandedFiles);

  if (next.has(fileName)) {
    next.delete(fileName);
  } else {
    next.add(fileName);
  }

  return next;
}
