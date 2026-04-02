import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSlashCommands,
  getSlashCommands,
} from "../src/terminal/slashCommands.ts";

test("Claude terminals expose built-in slash commands", () => {
  const commands = getSlashCommands("claude").map((command) => command.command);

  assert.ok(commands.includes("/help"));
  assert.ok(commands.includes("/compact"));
  assert.ok(commands.includes("/skills"));
});

test("Codex terminals expose built-in slash commands", () => {
  const commands = getSlashCommands("codex").map((command) => command.command);

  assert.ok(commands.includes("/help"));
  assert.ok(commands.includes("/skills"));
});

test("filterSlashCommands narrows results by query", () => {
  const commands = filterSlashCommands("claude", "comp").map(
    (command) => command.command,
  );

  assert.ok(commands.includes("/compact"));
});
