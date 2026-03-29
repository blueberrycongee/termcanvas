import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTaskPackageContext, renderTaskPackageTemplate } from "../src/task-package.ts";

test("Hydra skill copy documents root-cause-first, no test hacking, and result gate rules", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.resolve(here, "..", "..", "skills", "skills", "hydra", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf-8");

  assert.doesNotMatch(skill, /alwaysApply:\s*true/i);
  assert.match(skill, /hydra run --task ".*" --repo \./i);
  assert.match(skill, /--template single-step/i);
  assert.match(skill, /hydra spawn/i);
  assert.match(skill, /not a full workflow run/i);
  assert.match(skill, /hydra list/i);
  assert.match(skill, /planner -> implementer -> evaluator/i);
  assert.match(skill, /root cause/i);
  assert.match(skill, /Do not hack tests|test hacking/i);
  assert.match(skill, /silent fallback|swallow/i);
  assert.match(skill, /termcanvas terminal create --prompt/i);
  assert.match(skill, /Do not use `termcanvas terminal input`|not a supported automation path/i);
  assert.match(skill, /result\.json/i);
  assert.match(skill, /done/i);
  assert.match(skill, /hydra run|hydra tick|hydra watch|hydra status|hydra retry/i);
  assert.match(skill, /termcanvas telemetry get --workflow/i);
  assert.match(skill, /termcanvas telemetry get --terminal/i);
  assert.match(skill, /hydra watch.*polling loop|polling loop.*hydra watch/i);
  assert.match(skill, /awaiting_contract/i);
  assert.match(skill, /stall_candidate/i);
});

test("router skill stays always-on and classifies TermCanvas work before Hydra", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.resolve(here, "..", "..", "skills", "skills", "using-termcanvas", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf-8");

  assert.match(skill, /alwaysApply:\s*true/i);
  assert.match(skill, /rename/i);
  assert.match(skill, /do it directly/i);
  assert.match(skill, /hydra init/i);
  assert.match(skill, /single-step/i);
  assert.match(skill, /planner -> implementer -> evaluator/i);
  assert.match(skill, /hydra spawn/i);
  assert.match(skill, /hydra list/i);
  assert.match(skill, /termcanvas terminal create --prompt/i);
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
  assert.match(rendered, /"success": true/);
  assert.match(rendered, /"summary": "Explain what changed and whether the handoff passed\."/);
  assert.match(rendered, /"outputs": \[/);
  assert.match(rendered, /"evidence": \[/);
  assert.match(rendered, /next_action/);
  assert.match(rendered, /## Telemetry Checks/);
  assert.match(rendered, /termcanvas telemetry get --workflow workflow-auth --repo \./);
  assert.match(rendered, /termcanvas telemetry events --terminal <terminalId> --limit 20/);
  assert.match(rendered, /awaiting_contract/i);
  assert.match(rendered, /stall_candidate/i);
});
