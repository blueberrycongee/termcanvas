import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const AGENT_STORE_SCHEMA_VERSION = "hydra/agent-store/v2";

export interface AgentRecord {
  schema_version: typeof AGENT_STORE_SCHEMA_VERSION;
  id: string;
  task: string;
  type: string;
  role?: string;
  workflowId?: string;
  assignmentId?: string;
  runId?: string;
  repo: string;
  terminalId: string;
  worktreePath: string;
  branch: string | null;
  baseBranch: string;
  ownWorktree: boolean;
  taskFile?: string;
  resultFile?: string;
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
  const filePath = agentPath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const record = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AgentRecord;
  if (record.schema_version !== AGENT_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported agent store schema for ${id}: expected ${AGENT_STORE_SCHEMA_VERSION}, received ${String(record.schema_version ?? "<missing>")}`,
    );
  }
  return record;
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
        const record = JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as AgentRecord;
        if (record.schema_version !== AGENT_STORE_SCHEMA_VERSION) {
          throw new Error(
            `Unsupported agent store schema in ${f}: expected ${AGENT_STORE_SCHEMA_VERSION}, received ${String(record.schema_version ?? "<missing>")}`,
          );
        }
        return record;
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
  }
}
