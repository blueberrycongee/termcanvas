export const GRAPH_COLORS = [
  "var(--git-graph-blue)",
  "var(--git-graph-purple)",
  "var(--git-graph-cyan)",
  "var(--git-graph-amber)",
  "var(--git-graph-pink)",
  "var(--git-graph-green)",
];

export interface GitGraphInputCommit {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  message: string;
}

export interface GraphCommit extends GitGraphInputCommit {
  lane: number;
  row: number;
}

export interface GraphEdge {
  fromHash: string;
  toHash: string;
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: string;
}

export function buildGitGraph(commits: GitGraphInputCommit[]): {
  commits: GraphCommit[];
  edges: GraphEdge[];
} {
  const activeLanes: Array<string | null> = [];
  const graphCommits: GraphCommit[] = [];

  const allocateLane = () => {
    const freeLane = activeLanes.findIndex((value) => value === null);
    if (freeLane !== -1) {
      return freeLane;
    }
    activeLanes.push(null);
    return activeLanes.length - 1;
  };

  for (const [row, commit] of commits.entries()) {
    let lane = activeLanes.findIndex((value) => value === commit.hash);
    if (lane === -1) {
      lane = allocateLane();
    }

    graphCommits.push({
      ...commit,
      lane,
      row,
    });

    for (let index = 0; index < activeLanes.length; index += 1) {
      if (activeLanes[index] === commit.hash) {
        activeLanes[index] = null;
      }
    }

    const [firstParent, ...mergeParents] = commit.parents;
    if (firstParent) {
      const existingFirstParentLane = activeLanes.findIndex(
        (value) => value === firstParent,
      );
      if (existingFirstParentLane === -1 || existingFirstParentLane === lane) {
        activeLanes[lane] = firstParent;
      } else {
        activeLanes[lane] = null;
      }
    } else {
      activeLanes[lane] = null;
    }

    for (const parent of mergeParents) {
      if (activeLanes.includes(parent)) {
        continue;
      }
      const parentLane = allocateLane();
      activeLanes[parentLane] = parent;
    }

    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop();
    }
  }

  const commitMap = new Map(graphCommits.map((commit) => [commit.hash, commit]));
  const edges: GraphEdge[] = [];

  for (const commit of graphCommits) {
    for (const parent of commit.parents) {
      const parentCommit = commitMap.get(parent);
      if (!parentCommit) {
        continue;
      }

      edges.push({
        fromHash: commit.hash,
        toHash: parentCommit.hash,
        fromLane: commit.lane,
        fromRow: commit.row,
        toLane: parentCommit.lane,
        toRow: parentCommit.row,
        color: GRAPH_COLORS[commit.lane % GRAPH_COLORS.length],
      });
    }
  }

  return {
    commits: graphCommits,
    edges,
  };
}
