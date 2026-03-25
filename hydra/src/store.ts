import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentRecord {
  id: string;
  task: string;
  type: string;
  workflowId?: string;
  handoffId?: string;
  repo: string;
  terminalId: string;
  worktreePath: string;
  branch: string | null;
  baseBranch: string;
  ownWorktree: boolean;
  taskFile?: string;
  handoffFile?: string;
  resultFile?: string;
  doneFile?: string;
  createdAt: string;
}

function agentsDir(): string {
  const home = process.env.HYDRA_HOME ?? path.join(os.homedir(), ".hydra");
  const dir = path.join(home, "agents");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function agentPath(id: string): string {
  return path.join(agentsDir(), `${id}.json`);
}

export function saveAgent(record: AgentRecord): void {
  fs.writeFileSync(agentPath(record.id), JSON.stringify(record, null, 2));
}

export function loadAgent(id: string): AgentRecord | null {
  try {
    return JSON.parse(fs.readFileSync(agentPath(id), "utf-8"));
  } catch {
    return null;
  }
}

export function listAgents(repo?: string): AgentRecord[] {
  const dir = agentsDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const agents = files
    .map((f) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as AgentRecord;
      } catch {
        return null;
      }
    })
    .filter((a): a is AgentRecord => a !== null);

  if (repo) {
    const abs = path.resolve(repo);
    return agents.filter((a) => a.repo === abs);
  }
  return agents;
}

export function deleteAgent(id: string): void {
  try {
    fs.unlinkSync(agentPath(id));
  } catch {
    // already gone
  }
}
