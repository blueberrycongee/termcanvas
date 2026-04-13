import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getAssignmentStatePath,
} from "../layout.ts";
import {
  ASSIGNMENT_STATE_SCHEMA_VERSION,
  type AssignmentRecord,
  type AssignmentStatus,
} from "./types.ts";

export class AssignmentManager {
  private readonly repoPath: string;
  private readonly workbenchId: string;

  constructor(
    repoPath: string,
    workbenchId: string,
  ) {
    this.repoPath = repoPath;
    this.workbenchId = workbenchId;
  }

  generateAssignmentId(): string {
    return `assignment-${crypto.randomBytes(6).toString("hex")}`;
  }

  getAssignmentPath(dispatchId: string): string {
    return getAssignmentStatePath(this.repoPath, this.workbenchId, dispatchId);
  }

  create(
    assignment: Omit<
      AssignmentRecord,
      "schema_version" | "id" | "created_at" | "updated_at" | "status" | "retry_count" | "active_run_id" | "runs"
    > & Partial<Pick<AssignmentRecord, "id">>,
  ): AssignmentRecord {
    const now = new Date().toISOString();
    const fullAssignment: AssignmentRecord = {
      ...assignment,
      schema_version: ASSIGNMENT_STATE_SCHEMA_VERSION,
      id: assignment.id ?? this.generateAssignmentId(),
      created_at: now,
      updated_at: now,
      status: "pending",
      retry_count: 0,
      active_run_id: null,
      runs: [],
    };
    this.save(fullAssignment);
    return fullAssignment;
  }

  save(assignment: AssignmentRecord): void {
    const filePath = this.getAssignmentPath(assignment.id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(assignment, null, 2), "utf-8");
  }

  load(assignmentId: string): AssignmentRecord | null {
    const filePath = this.getAssignmentPath(assignmentId);
    if (!fs.existsSync(filePath)) return null;

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AssignmentRecord;
    if (parsed.schema_version !== ASSIGNMENT_STATE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported assignment state schema in ${filePath}: expected ${ASSIGNMENT_STATE_SCHEMA_VERSION}, received ${String(parsed.schema_version ?? "<missing>")}`,
      );
    }
    return parsed;
  }

  updateStatus(assignmentId: string, status: AssignmentStatus): void {
    const assignment = this.load(assignmentId);
    if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
    assignment.status = status;
    assignment.updated_at = new Date().toISOString();
    this.save(assignment);
  }
}
