const args = process.argv.slice(2);
const [command, ...rest] = args;

function printUsage() {
  console.log("Usage: hydra <spawn|list|cleanup|init> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  spawn    Spawn a sub-agent in a new TermCanvas terminal");
  console.log("  list     List all spawned agents");
  console.log("  cleanup  Clean up agent worktrees and terminals");
  console.log("  init     Add hydra instructions to project CLAUDE.md and AGENTS.md");
}

async function main() {
  switch (command) {
    case "spawn": {
      const { spawn } = await import("./spawn.js");
      await spawn(rest);
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
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
