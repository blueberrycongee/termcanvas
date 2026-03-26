import { HydraError, writeFailureLog } from "./errors.ts";

const args = process.argv.slice(2);
const [command, ...rest] = args;

function printUsage() {
  console.log("Usage: hydra <run|tick|watch|status|retry|spawn|list|cleanup|init> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  run      Create and start a file-contract workflow");
  console.log("  tick     Advance one workflow tick");
  console.log("  watch    Poll a workflow until it reaches a terminal state");
  console.log("  status   Show structured workflow status");
  console.log("  retry    Retry a failed or timed-out workflow");
  console.log("  spawn    Create one direct isolated worker terminal");
  console.log("  list     List all spawned agents");
  console.log("  cleanup  Clean up agent worktrees and terminals");
  console.log("  init     Add hydra instructions to project CLAUDE.md and AGENTS.md");
  console.log("");
  console.log("Execution modes:");
  console.log("  direct   stay in the current agent for simple/local tasks");
  console.log("  run      use single-step or planner -> implementer -> evaluator");
  console.log("  spawn    use one isolated worker when the split is already known");
}

async function main() {
  switch (command) {
    case "spawn": {
      const { spawn } = await import("./spawn.js");
      await spawn(rest);
      break;
    }
    case "run": {
      const { run } = await import("./run.js");
      await run(rest);
      break;
    }
    case "tick": {
      const { tick } = await import("./tick.js");
      await tick(rest);
      break;
    }
    case "watch": {
      const { watch } = await import("./watch.js");
      await watch(rest);
      break;
    }
    case "status": {
      const { status } = await import("./status.js");
      await status(rest);
      break;
    }
    case "retry": {
      const { retry } = await import("./retry-command.js");
      await retry(rest);
      break;
    }
    case "list": {
      const { list } = await import("./list.js");
      await list(rest);
      break;
    }
    case "cleanup": {
      const { cleanup } = await import("./cleanup.js");
      await cleanup(rest);
      break;
    }
    case "init": {
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
          errorCode: "CLI_UNKNOWN_COMMAND",
          stage: "cli.dispatch",
          ids: { command },
        }),
        {
          errorCode: "CLI_UNKNOWN_COMMAND",
          stage: "cli.dispatch",
          ids: { command },
        },
      );
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  writeFailureLog(err, {
    errorCode: "CLI_COMMAND_FAILED",
    stage: command ? `cli.${command}` : "cli.entrypoint",
    ids: {
      command,
    },
  });
  process.exit(1);
});
