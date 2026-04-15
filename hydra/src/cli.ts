import { HydraError, writeFailureLog } from "./errors.ts";
import {
  cliInit,
  cliDispatch,
  cliWatch,
  cliRedispatch,
  cliApprove,
  cliReset,
  cliRollback,
  cliAsk,
  cliMerge,
  cliComplete,
  cliFail,
  cliStatus,
  cliLedger,
  cliListRoles,
} from "./cli-commands.ts";
import { list } from "./list.ts";
import { spawn, injectScanDefaults } from "./spawn.ts";
import { cleanup } from "./cleanup.ts";
import { init as initRepo } from "./init.ts";

const args = process.argv.slice(2);
const [command, ...rest] = args;

function printUsage() {
  console.log("Usage: hydra <command> [options]");
  console.log("");
  console.log("Lead-driven workflow commands:");
  console.log("  init       Create a new workflow context");
  console.log("  dispatch   Dispatch an agent node into a workflow");
  console.log("  watch      Wait until a decision point is reached");
  console.log("  approve    Mark a node's output as approved");
  console.log("  reset      Reset a node (and downstream) for re-run");
  console.log("  rollback   Rollback a dispatch's worktree to its pre-dispatch checkpoint");
  console.log("  ask        Ask a completed node a follow-up question via session resume");
  console.log("  merge      Merge parallel worktree branches");
  console.log("  complete   Mark a workflow as completed");
  console.log("  fail       Mark a workflow as failed");
  console.log("");
  console.log("Inspection:");
  console.log("  status      Show structured workflow status");
  console.log("  list        List workflows or spawned agents");
  console.log("  list-roles  List role registry entries (project + user + builtin)");
  console.log("  ledger      Show workflow event log");
  console.log("");
  console.log("Housekeeping:");
  console.log("  spawn      Create one direct isolated worker terminal");
  console.log("  scan       Scan codebase for entropy (shortcut for spawn --role janitor)");
  console.log("  cleanup    Clean up workflow state and worktrees");
  console.log("  init-repo  Add hydra instructions to project CLAUDE.md");
}

async function main() {
  switch (command) {
    // --- Lead-driven workflow ---
    case "init":
      await cliInit(rest);
      break;
    case "dispatch":
      await cliDispatch(rest);
      break;
    case "watch":
      await cliWatch(rest);
      break;
    case "redispatch":
      await cliRedispatch(rest);
      break;
    case "approve":
      await cliApprove(rest);
      break;
    case "reset":
      await cliReset(rest);
      break;
    case "rollback":
      await cliRollback(rest);
      break;
    case "ask":
      await cliAsk(rest);
      break;
    case "merge":
      await cliMerge(rest);
      break;
    case "complete":
      await cliComplete(rest);
      break;
    case "fail":
      await cliFail(rest);
      break;

    // --- Inspection ---
    case "status":
      await cliStatus(rest);
      break;
    case "ledger":
      await cliLedger(rest);
      break;
    case "list":
      await list(rest);
      break;
    case "list-roles":
      await cliListRoles(rest);
      break;

    // --- Housekeeping ---
    case "spawn":
      await spawn(rest);
      break;
    case "scan":
      await spawn(injectScanDefaults(rest));
      break;
    case "cleanup":
      await cleanup(rest);
      break;
    case "init-repo":
      await initRepo();
      break;

    case "--help":
    case "-h":
    case undefined:
      printUsage();
      process.exit(0);
    default:
      writeFailureLog(
        new HydraError(`Unknown command: ${command}`, {
          errorCode: "CLI_UNKNOWN_COMMAND", stage: "cli.dispatch", ids: { command },
        }),
        { errorCode: "CLI_UNKNOWN_COMMAND", stage: "cli.dispatch", ids: { command } },
      );
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  writeFailureLog(err, {
    errorCode: "CLI_COMMAND_FAILED",
    stage: command ? `cli.${command}` : "cli.entrypoint",
    ids: { command },
  });
  process.exit(1);
});
