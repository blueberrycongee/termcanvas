export interface RepoContextOption {
  name: string;
  path: string;
}

export interface RepoContextResolution {
  selectedRepoPath: string | null;
  selectorKind: "none" | "single" | "inline" | "dropdown";
  targetPath: string | null;
}

export function resolveRepoContext(params: {
  childRepos: RepoContextOption[];
  directoryIsGitRepo: boolean;
  directoryPath: string | null;
  preferredRepoPath?: string | null;
}): RepoContextResolution {
  const {
    childRepos,
    directoryIsGitRepo,
    directoryPath,
    preferredRepoPath = null,
  } = params;

  if (!directoryPath) {
    return {
      selectedRepoPath: null,
      selectorKind: "none",
      targetPath: null,
    };
  }

  if (directoryIsGitRepo || childRepos.length === 0) {
    return {
      selectedRepoPath: null,
      selectorKind: "none",
      targetPath: directoryPath,
    };
  }

  const matchingPreferred = childRepos.find(
    (repo) => repo.path === preferredRepoPath,
  );
  const selectedRepoPath = matchingPreferred?.path ?? childRepos[0]?.path ?? null;

  return {
    selectedRepoPath,
    selectorKind:
      childRepos.length === 1
        ? "single"
        : childRepos.length === 2
          ? "inline"
          : "dropdown",
    targetPath: selectedRepoPath,
  };
}
