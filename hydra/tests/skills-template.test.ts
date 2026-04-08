import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderRunTask } from "../src/run-task.ts";

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
  assert.match(skill, /researcher -> implementer -> tester/i);
  assert.match(skill, /root cause/i);
  assert.match(skill, /Do not hack tests|test hacking/i);
  assert.match(skill, /silent fallback|swallow/i);
  assert.match(skill, /termcanvas terminal create --prompt/i);
  assert.match(skill, /Do not use `termcanvas terminal input`|not a supported automation path/i);
  assert.match(skill, /result\.json/i);
  assert.doesNotMatch(skill, /result\.json\s*\+\s*`done`|result\.json.*done/i);
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
  assert.match(skill, /challenge/i);
  assert.match(skill, /do it directly/i);
  assert.match(skill, /hydra init/i);
  assert.match(skill, /single-step/i);
  assert.match(skill, /researcher -> implementer -> tester/i);
  assert.match(skill, /hydra spawn/i);
  assert.match(skill, /hydra list/i);
  assert.match(skill, /termcanvas terminal create --prompt/i);
});

test("challenge skill defines four orthogonal attack methodologies", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.resolve(here, "..", "..", "skills", "skills", "challenge", "SKILL.md");
  const skill = fs.readFileSync(skillPath, "utf-8");

  assert.doesNotMatch(skill, /alwaysApply:\s*true/i);
  assert.match(skill, /hydra spawn/i);
  assert.match(skill, /hydra watch --agent/i);
  assert.match(skill, /Counterexample/i);
  assert.match(skill, /Hidden Assumptions/i);
  assert.match(skill, /Mechanism & Second-Order Effects/i);
  assert.match(skill, /Boundary & Context Shift/i);
  assert.match(skill, /result\.json/i);
  assert.match(skill, /severity/i);
  assert.match(skill, /critical/i);
  assert.match(skill, /neutral/i);
});

test("task template links role guidance and result-only completion rules", () => {
  const rendered = renderRunTask({
    repoPath: "/repo/project",
    workflowId: "workflow-auth",
    assignmentId: "assignment-abc123",
    runId: "run-0001",
    role: "tester",
    agentType: "claude",
    sourceRole: "implementer",
    objective: ["Verify the implementation honestly."],
    readFiles: [
      { label: "User request", path: "/repo/project/.hydra/workflows/workflow-auth/inputs/user-request.md" },
    ],
    writeTargets: [
      {
        label: "Brief",
        path: "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-0001/artifacts/brief.md",
      },
      {
        label: "Result JSON",
        path: "/repo/project/.hydra/workflows/workflow-auth/assignments/assignment-abc123/runs/run-0001/result.json",
      },
    ],
    decisionRules: ["- Form an independent judgment before trusting the implementer's summary."],
    acceptanceCriteria: ["Write a valid result.json file"],
    skills: ["qa", "code-review"],
    extraSections: [
      {
        title: "Verification Strategy",
        lines: ["- Start with baseline checks first and stop early if they fail."],
      },
    ],
  });

  assert.match(rendered, /## Role/);
  assert.match(rendered, /You are the tester/);
  assert.match(rendered, /## Objective/);
  assert.match(rendered, /## Read First/);
  assert.match(rendered, /## Write Targets/);
  assert.match(rendered, /## Decision Rules/);
  assert.match(rendered, /## Skills/);
  assert.match(rendered, /qa/);
  assert.match(rendered, /code-review/);
  assert.match(rendered, /Root cause first/i);
  assert.match(rendered, /Do not fake outputs/i);
  assert.match(rendered, /silent fallbacks/i);
  assert.match(rendered, /result\.json/);
  assert.match(rendered, /## Operational Notes/);
  assert.match(rendered, /terminal prose/i);
  assert.match(rendered, /## Completion/);
  assert.doesNotMatch(rendered, /\bdone\b/i);
});
