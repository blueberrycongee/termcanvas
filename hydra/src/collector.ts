import fs from "node:fs";
import {
  validateWorkflowResultContract,
  type WorkflowResultContract,
} from "./protocol.ts";

export interface CollectorFailure {
  code: string;
  message: string;
  stage: string;
}

export type CollectRunResult =
  | {
      status: "waiting";
      advance: false;
      reason: "result_missing";
    }
  | {
      status: "failed";
      advance: false;
      failure: CollectorFailure;
    }
  | {
      status: "completed";
      advance: true;
      result: WorkflowResultContract;
    };

export interface RunResultExpectation {
  workflow_id: string;
  assignment_id: string;
  run_id: string;
  result_file: string;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function collectRunResult(expectation: RunResultExpectation): CollectRunResult {
  if (!fs.existsSync(expectation.result_file)) {
    return {
      status: "waiting",
      advance: false,
      reason: "result_missing",
    };
  }

  try {
    const result = validateWorkflowResultContract(readJsonFile(expectation.result_file), expectation);
    return {
      status: "completed",
      advance: true,
      result,
    };
  } catch (error: unknown) {
    return {
      status: "failed",
      advance: false,
      failure: {
        code: "COLLECTOR_RESULT_INVALID",
        message: error instanceof Error ? error.message : String(error),
        stage: "collector.validate_result",
      },
    };
  }
}
