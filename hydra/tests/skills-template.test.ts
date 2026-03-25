import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildTaskPackageContext, renderTaskPackageTemplate } from "../src/task-package.ts";

test("Hydra skill copy documents root-cause-first, no test hacking, and result gate rules", () => {
  const skillPath = path.resolve(process.cwd(), "..", "skills", "skills", "hydra", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf-8");

  assert.match(skill, /root cause/i);
  assert.match(skill, /Do not hack tests|test hacking/i);
  assert.match(skill, /silent fallback|swallow/i);
  assert.match(skill, /result\.json/i);
  assert.match(skill, /done/i);
  assert.match(skill, /hydra run|hydra tick|hydra watch|hydra status|hydra retry/i);
});

test("task package template links skills and hard gate requirements", () => {
  const context = buildTaskPackageContext({
    workspaceRoot: "/repo/project",
    workflowId: "workflow-auth",
    handoffId: "handoff-abc123",
    createdAt: "2026-03-26T12:00:00.000Z",
    from: {
      role: "planner",
      agent_type: "claude",
      agent_id: "claude-session-1",
    },
    to: {
      role: "implementer",
      agent_type: "codex",
      agent_id: null,
    },
    task: {
      type: "implement-feature",
      title: "Implement workflow gate",
      description: "Build the workflow gate.",
      acceptance_criteria: ["Write valid result and done"],
      skills: ["test-driven-development"],
    },
    context: {
      files: [],
      previous_handoffs: [],
    },
  });
  const rendered = renderTaskPackageTemplate(context.contract);

  assert.match(rendered, /## Skills/);
  assert.match(rendered, /test-driven-development/);
  assert.match(rendered, /Root cause first/i);
  assert.match(rendered, /Do not hack tests/i);
  assert.match(rendered, /silent fallbacks/i);
  assert.match(rendered, /success: boolean/);
  assert.match(rendered, /summary: string/);
  assert.match(rendered, /outputs\[\]/);
  assert.match(rendered, /evidence\[\]/);
  assert.match(rendered, /next_action/);
});
