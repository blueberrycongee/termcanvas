import fs from "node:fs";
import {
  validateDoneMarker,
  validateResultContract,
  type DoneMarker,
  type HandoffContract,
  type ResultContract,
} from "./protocol.ts";

export interface CollectorFailure {
  code: string;
  message: string;
  stage: string;
}

export type CollectTaskPackageResult =
  | {
      status: "waiting";
      advance: false;
      reason: "done_missing";
    }
  | {
      status: "failed";
      advance: false;
      failure: CollectorFailure;
    }
  | {
      status: "completed";
      advance: true;
      result: ResultContract;
      done: DoneMarker;
    };

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function writeResultContract(
  contract: Pick<HandoffContract, "artifacts">,
  result: ResultContract,
): void {
  fs.writeFileSync(contract.artifacts.result_file, JSON.stringify(result, null, 2), "utf-8");
}

export function writeDoneMarker(
  contract: Pick<HandoffContract, "artifacts" | "handoff_id" | "workflow_id">,
): void {
  const done: DoneMarker = {
    version: "hydra/v2",
    handoff_id: contract.handoff_id,
    workflow_id: contract.workflow_id,
    result_file: contract.artifacts.result_file,
  };
  fs.writeFileSync(contract.artifacts.done_file, JSON.stringify(done, null, 2), "utf-8");
}

export function collectTaskPackage(contract: HandoffContract): CollectTaskPackageResult {
  if (!fs.existsSync(contract.artifacts.done_file)) {
    return {
      status: "waiting",
      advance: false,
      reason: "done_missing",
    };
  }

  let done: DoneMarker;
  try {
    done = validateDoneMarker(readJsonFile(contract.artifacts.done_file), contract);
  } catch (error: unknown) {
    return {
      status: "failed",
      advance: false,
      failure: {
        code: "COLLECTOR_DONE_INVALID",
        message: error instanceof Error ? error.message : String(error),
        stage: "collector.validate_done",
      },
    };
  }

  if (!fs.existsSync(contract.artifacts.result_file)) {
    return {
      status: "failed",
      advance: false,
      failure: {
        code: "COLLECTOR_RESULT_MISSING",
        message: `Missing result file: ${contract.artifacts.result_file}`,
        stage: "collector.read_result",
      },
    };
  }

  try {
    const result = validateResultContract(readJsonFile(contract.artifacts.result_file), contract);
    return {
      status: "completed",
      advance: true,
      result,
      done,
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
