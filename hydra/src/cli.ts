import { HydraError, writeFailureLog } from "./errors.ts";

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
  console.log("  cleanup    Clean up workflow state and worktrees");
  console.log("  init-repo  Add hydra instructions to project CLAUDE.md");
}

async function main() {
  switch (command) {
    // --- Lead-driven workflow ---
    case "init": {
      const { cliInit } = await import("./cli-commands.js");
      await cliInit(rest);
      break;
    }
    case "dispatch": {
      const { cliDispatch } = await import("./cli-commands.js");
      await cliDispatch(rest);
      break;
    }
    case "watch": {
      const { cliWatch } = await import("./cli-commands.js");
      await cliWatch(rest);
      break;
    }
    case "redispatch": {
      const { cliRedispatch } = await import("./cli-commands.js");
      await cliRedispatch(rest);
      break;
    }
    case "approve": {
      const { cliApprove } = await import("./cli-commands.js");
      await cliApprove(rest);
      break;
    }
    case "reset": {
      const { cliReset } = await import("./cli-commands.js");
      await cliReset(rest);
      break;
    }
    case "merge": {
      const { cliMerge } = await import("./cli-commands.js");
      await cliMerge(rest);
      break;
    }
    case "complete": {
      const { cliComplete } = await import("./cli-commands.js");
      await cliComplete(rest);
      break;
    }
    case "fail": {
      const { cliFail } = await import("./cli-commands.js");
      await cliFail(rest);
      break;
    }

    // --- Inspection ---
    case "status": {
      const { cliStatus } = await import("./cli-commands.js");
      await cliStatus(rest);
      break;
    }
    case "ledger": {
      const { cliLedger } = await import("./cli-commands.js");
      await cliLedger(rest);
      break;
    }
    case "list": {
      const { list } = await import("./list.js");
      await list(rest);
      break;
    }
    case "list-roles": {
      const { cliListRoles } = await import("./cli-commands.js");
      await cliListRoles(rest);
      break;
    }

    // --- Housekeeping ---
    case "spawn": {
      const { spawn } = await import("./spawn.js");
      await spawn(rest);
      break;
    }
    case "cleanup": {
      const { cleanup } = await import("./cleanup.js");
      await cleanup(rest);
      break;
    }
    case "init-repo": {
      const { init } = await import("./init.js");
      await init();
      break;
    }

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
