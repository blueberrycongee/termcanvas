import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSlashCommands,
  getSlashCommands,
} from "../src/terminal/slashCommands.ts";

test("Claude terminals expose the TermCanvas rename skill in slash commands", () => {
  const commands = getSlashCommands("claude").map((command) => command.command);

  assert.ok(commands.includes("/termcanvas:rename"));
});

test("Codex terminals expose the TermCanvas rename skill in slash commands", () => {
  const commands = getSlashCommands("codex").map((command) => command.command);

  assert.ok(commands.includes("/termcanvas:rename"));
});

test("filterSlashCommands finds the TermCanvas rename skill by plugin prefix", () => {
  const commands = filterSlashCommands("claude", "termcanvas").map(
    (command) => command.command,
  );

  assert.deepEqual(commands, ["/termcanvas:rename"]);
});
