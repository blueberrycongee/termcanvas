import { startServer, setCommandRegistry } from "./server.ts";
import { createCommandRegistry } from "./commands/index.ts";

setCommandRegistry(createCommandRegistry());
await startServer();
