import fs from "node:fs";
import path from "node:path";
import {
  PROTOCOL_VERSION,
  buildTaskPackagePaths,
  type HandoffContract,
  type ProtocolAgent,
  type ProtocolContext,
  type ProtocolTask,
  type TaskPackagePaths,
} from "./protocol.ts";

export interface BuildTaskPackageContextInput {
  workspaceRoot: string;
  workflowId: string;
  handoffId: string;
  createdAt?: string;
  from: ProtocolAgent;
  to: ProtocolAgent;
  task: ProtocolTask;
  context: ProtocolContext;
}

export interface TaskPackageContext {
  contract: HandoffContract;
}

export function buildTaskPackageDir(
  workspaceRoot: string,
  workflowId: string,
  handoffId: string,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    ".hydra",
    "workflows",
    workflowId,
    handoffId,
  );
}

export function buildTaskPackageContext(
  input: BuildTaskPackageContextInput,
): TaskPackageContext {
  const packageDir = buildTaskPackageDir(input.workspaceRoot, input.workflowId, input.handoffId);

  return {
    contract: {
      version: PROTOCOL_VERSION,
      handoff_id: input.handoffId,
      workflow_id: input.workflowId,
      created_at: input.createdAt ?? new Date().toISOString(),
      from: input.from,
      to: input.to,
      task: input.task,
      context: input.context,
      artifacts: buildTaskPackagePaths(packageDir),
    },
  };
}

function renderList(items: string[], emptyMessage: string): string[] {
  if (items.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return items.map((item) => `- ${item}`);
}

// ── Planner domain audit guides ──

const PLAN_GUIDE_FRONTEND = `# Frontend Audit Guide

Read this guide when the task involves UI components, pages, or user-facing interactions.

## User Flow
- Map each user flow through the changed area: entry → actions → outcomes.
- Identify dead ends — states the user can reach but has nothing useful to do.
- Identify missing feedback — operations that leave the user without indication of progress, success, or failure.

## Interaction Quality
- Are state transitions visually continuous, or do elements appear/disappear abruptly?
- Are interactive elements discoverable — can the user tell what is clickable, draggable, or expandable?
- Are hover, active, and focus states consistent across similar elements?
- Can all features be reached and operated via keyboard?

## Layout Integrity
- Are scroll containers actually scrollable, or do layout constraints prevent overflow from working?
- Does the layout handle dynamic content sizes without breaking (very long text, empty states, many items)?
- Does the layout degrade gracefully when the container is resized?

## Visual Consistency
- Are typography, spacing, and color choices consistent with the rest of the application?
- Are all colors and dimensions sourced from the design system, or are there hardcoded values?
`;

const PLAN_GUIDE_BACKEND = `# Backend Audit Guide

Read this guide when the task involves APIs, services, data processing, or server-side logic.

## API Contract Audit
- List all endpoints/functions affected by the change. For each: what are the inputs, outputs, and error cases?
- Are there callers that depend on the current behavior? Will they break?
- Are error responses consistent with the rest of the API (same shape, same status codes)?

## Data Flow Audit
- Trace data from input to storage to output. Where can it be corrupted, lost, or leaked?
- Are there race conditions in concurrent access patterns (read-modify-write without locking)?
- Do write operations that must be atomic use transactions?
- If the change involves migrations: is the migration reversible? Does it handle existing data?

## Performance Risks
- N+1 query patterns in loops that access related data.
- Unbounded result sets without pagination.
- Expensive operations (network calls, file I/O) in hot paths that could be deferred or cached.
- Memory concerns: large objects in closures, unbounded caches, streams not piped.

## Security Risks
- User input reaching business logic without validation/sanitization.
- String interpolation in SQL queries (must be parameterized).
- Secrets in code, logs, or error responses.
- Authentication/authorization gaps on new or modified routes.
`;

const PLAN_GUIDE_INFRA = `# Infrastructure Audit Guide

Read this guide when the task involves deployment, configuration, CI/CD, or operational tooling.

## Configuration Audit
- Are environment-specific values externalized (env vars, config files), not hardcoded?
- Is there a clear separation between secrets and non-secret configuration?
- Are defaults sensible for local development?

## Deployment Risks
- Can the change be deployed without downtime?
- Is it backward-compatible during rolling deployment?
- Is there a rollback path?
- If database changes are involved: can the migration run while old code serves traffic?

## Observability
- Are meaningful log messages emitted at appropriate levels?
- Do logs include correlation IDs for tracing?
- Are key metrics instrumented (latency, error rate, throughput)?
`;

const PLANNER_GUIDES: Record<string, { filename: string; content: string }> = {
  frontend: { filename: "plan-frontend.md", content: PLAN_GUIDE_FRONTEND },
  backend: { filename: "plan-backend.md", content: PLAN_GUIDE_BACKEND },
  infra: { filename: "plan-infra.md", content: PLAN_GUIDE_INFRA },
};

// ── Evaluator domain evaluation guides ──

const EVAL_GUIDE_FRONTEND = `# Frontend Evaluation Guide

Read this guide when the task involves UI components, pages, or user-facing interactions.

## Visual Design
- Does the UI have a coherent visual identity — consistent color palette, typography scale, and spacing rhythm?
- Are visual elements aligned to a grid or layout system, or do they feel randomly placed?
- Does the design avoid the "AI-generated" look — generic gradients, overused card layouts, default shadows?
- Is there clear visual hierarchy? Can you tell at a glance what is primary, secondary, and tertiary?
- Are colors accessible? Check contrast ratios for text on backgrounds (WCAG AA minimum: 4.5:1 for normal text).

## Interaction & UX Flow
- Walk through the primary user flow end to end. Does every step feel intentional?
- Are loading states present where async operations happen? No sudden blank screens.
- Do error states provide actionable feedback, not just "Something went wrong"?
- Are transitions and animations purposeful (guiding attention) or gratuitous (distracting)?
- Can the user undo or recover from mistakes? Are destructive actions guarded with confirmation?
- Does the UI respond to user input within 100ms? Anything slower needs a visual indicator.

## Responsive & Adaptive
- Does the layout work at common breakpoints (mobile 375px, tablet 768px, desktop 1280px)?
- Are touch targets at least 44x44px on mobile?
- Does text remain readable without horizontal scrolling at any viewport width?
- Are images and media sized appropriately — no oversized assets on mobile, no blurry upscaling on desktop?

## Accessibility
- Can all interactive elements be reached and activated via keyboard alone (Tab, Enter, Escape)?
- Do form inputs have associated labels (not just placeholder text)?
- Are semantic HTML elements used (button, nav, main, article) instead of generic divs with click handlers?
- Do images have meaningful alt text (or empty alt for decorative images)?
- Does the page have a logical heading hierarchy (h1 → h2 → h3, no skipped levels)?
`;

const EVAL_GUIDE_BACKEND = `# Backend Evaluation Guide

Read this guide when the task involves APIs, services, data processing, or server-side logic.

## Performance
- Are database queries efficient? Look for N+1 query patterns, missing indexes on filtered/joined columns, and SELECT * when only a few columns are needed.
- Are expensive operations (network calls, file I/O, heavy computation) happening in hot paths where they could be deferred, batched, or cached?
- For list endpoints: is pagination implemented? Unbounded result sets are a production incident waiting to happen.
- Are there obvious memory concerns — large objects held in closures, unbounded in-memory caches, streams not properly piped?

## Security
- Is user input validated and sanitized at the system boundary before reaching business logic?
- Are SQL queries parameterized? String interpolation into queries is always a defect.
- Is authentication checked on every protected route, not just assumed from middleware ordering?
- Are secrets (API keys, tokens, passwords) kept out of code, logs, and error responses?
- For APIs accepting file uploads: are file types, sizes, and paths validated?

## Data Consistency
- Do write operations that must be atomic use transactions or equivalent mechanisms?
- Are error paths cleaning up partial state, or can a failed operation leave data in an inconsistent state?
- Are concurrent access patterns considered? Race conditions in read-modify-write cycles are common and subtle.
- If the task involves migrations: is the migration reversible? Does it handle existing data gracefully?

## API Contract
- Do endpoints return consistent response shapes? Same structure for success, error, and empty states.
- Are HTTP status codes semantically correct (201 for creation, 404 for not found, 409 for conflict)?
- Are error responses structured and machine-readable, not just string messages?
- Is the API versioned or otherwise protected against breaking changes for existing consumers?

## Error Handling
- Do errors propagate with enough context to diagnose the root cause? A generic "Internal Server Error" in production logs is useless.
- Are retryable vs. non-retryable errors distinguished? Retrying a 400 is a bug.
- Are external service failures handled gracefully — timeouts, circuit breakers, fallback behavior where appropriate?
`;

const EVAL_GUIDE_INFRA = `# Infrastructure Evaluation Guide

Read this guide when the task involves deployment, configuration, CI/CD, or operational tooling.

## Configuration
- Are environment-specific values (URLs, feature flags, resource limits) externalized into environment variables or config files, not hardcoded?
- Is there a clear separation between secrets and non-secret configuration?
- Are default values sensible for local development without requiring manual setup?
- Is the configuration documented or self-describing (typed config schemas, .env.example)?

## Deployment
- Can the change be deployed without downtime? Rolling deploys, blue-green, or feature flags?
- Is the change backward-compatible with the previous version during rollout?
- If a database migration is involved: can it run while the old code is still serving traffic?
- Is there a clear rollback path if the deployment fails?

## Observability
- Are meaningful log messages emitted at appropriate levels (info for business events, warn for recoverable issues, error for failures)?
- Do logs include correlation IDs or request context for tracing across services?
- Are key metrics (latency, error rate, throughput) instrumented or already covered by existing middleware?
- Will alerts fire for the right conditions, with enough context to diagnose without guessing?

## CI/CD Pipeline
- Do the changes affect build or test pipelines? If so, are the pipeline definitions updated?
- Are new dependencies pinned to specific versions, not floating ranges?
- Are build artifacts reproducible — same input produces same output?
`;

const EVALUATOR_GUIDES: Record<string, { filename: string; content: string }> = {
  frontend: { filename: "eval-frontend.md", content: EVAL_GUIDE_FRONTEND },
  backend: { filename: "eval-backend.md", content: EVAL_GUIDE_BACKEND },
  infra: { filename: "eval-infra.md", content: EVAL_GUIDE_INFRA },
};

function renderPlannerDomainGuideReference(
  role: string,
  packageDir: string,
): string[] {
  if (role !== "planner") {
    return [];
  }
  const lines = [
    "## Domain-Specific Audit Guides",
    "",
    "The following guides contain audit checklists for specific task types.",
    "Read the ones relevant to this task to guide your investigation — skip the rest:",
    "",
  ];
  for (const [domain, guide] of Object.entries(PLANNER_GUIDES)) {
    lines.push(
      `- **${domain}**: ${path.join(packageDir, guide.filename)}`,
    );
  }
  lines.push("");
  return lines;
}

function writePlannerGuides(contract: HandoffContract): void {
  if (contract.to.role !== "planner") {
    return;
  }
  for (const guide of Object.values(PLANNER_GUIDES)) {
    fs.writeFileSync(
      path.join(contract.artifacts.package_dir, guide.filename),
      guide.content,
      "utf-8",
    );
  }
}

function renderEvaluatorDomainGuideReference(
  role: string,
  packageDir: string,
): string[] {
  if (role !== "evaluator") {
    return [];
  }
  const lines = [
    "## Domain-Specific Evaluation Guides",
    "",
    "The following guides contain additional evaluation criteria for specific task types.",
    "Read the ones relevant to this task — skip the rest:",
    "",
  ];
  for (const [domain, guide] of Object.entries(EVALUATOR_GUIDES)) {
    lines.push(
      `- **${domain}**: ${path.join(packageDir, guide.filename)}`,
    );
  }
  lines.push("");
  return lines;
}

function writeEvaluatorGuides(contract: HandoffContract): void {
  if (contract.to.role !== "evaluator") {
    return;
  }
  for (const guide of Object.values(EVALUATOR_GUIDES)) {
    fs.writeFileSync(
      path.join(contract.artifacts.package_dir, guide.filename),
      guide.content,
      "utf-8",
    );
  }
}

function renderEvaluatorVerificationStrategy(role: string): string[] {
  if (role !== "evaluator") {
    return [];
  }
  return [
    "## Verification Strategy",
    "",
    "### Baseline (do this first, stop early if it fails)",
    "",
    "Run the test suite and build. For any task with UI changes, you MUST use the `browse` CLI to verify in a real browser — do not skip this step or substitute it with code reading. Run `browse goto <url>`, take screenshots with `browse screenshot`, test interactions with `browse click`/`browse fill`/`browse press`, and check `browse console` for errors. The browse server starts automatically on first use. Fall back to Playwright, Puppeteer, or Cypress only if browse is unavailable. If tests or build fail, report immediately — no further evaluation needed.",
    "",
    "### Deep evaluation (do this when the baseline passes)",
    "",
    "CI passing is table stakes. Focus on what automated checks cannot catch:",
    "",
    "- **Intent vs. implementation gap** — Read the planner spec, then read the code. Does the code actually deliver what was asked? A function that compiles but returns hardcoded data is a CI pass and a real failure.",
    "- **Stub and mock detection** — Search for empty function bodies, `// TODO` standing in for logic, placeholder return values, and test mocks that leaked into production code.",
    "- **Over/under-engineering** — Unnecessary abstractions, premature generalization, and god objects are defects. So is copy-paste duplication and magic numbers.",
    "- **Test honesty** — A test that asserts `expect(true).toBe(true)` or only validates a mock's return value is worse than no test — it creates false confidence. Flag dead tests, tautological assertions, and tests brittle to implementation details.",
    "- **User-facing quality** — For UI: try the interaction flow end to end. For APIs: check error responses, not just happy paths. For CLI: test discoverability and help text.",
    "- **Architectural coherence** — Does the new code follow existing patterns in the codebase, or does it introduce a conflicting style?",
    "",
    "### Reporting",
    "",
    "Include a `verification` object in your result JSON so the next agent knows exactly what was checked:",
    "```json",
    '"verification": {',
    '  "runtime":  { "ran": true,  "pass": true,  "detail": "42 tests passed" },',
    '  "build":    { "ran": true,  "pass": true,  "detail": "tsc clean" },',
    '  "probing":  { "ran": true,  "pass": false, "detail": "signup flow hangs after email input — no loading state" },',
    '  "static":   { "ran": true,  "pass": false, "detail": "handlePayment() is a stub returning hardcoded success" }',
    "}",
    "```",
    "If your highest completed tier is static analysis, explain why higher tiers were unavailable and apply stricter judgment before claiming success.",
    "",
  ];
}

export function renderTaskPackageTemplate(contract: HandoffContract): string {
  const lines = [
    "# Hydra Task Package",
    "",
    "This task is controlled by Hydra's file contract. Terminal conversation is not a source of truth.",
    "",
    "## Handoff",
    "",
    `- Version: ${contract.version}`,
    `- Workflow ID: ${contract.workflow_id}`,
    `- Handoff ID: ${contract.handoff_id}`,
    `- Created At: ${contract.created_at}`,
    `- From: ${contract.from.role} (${contract.from.agent_type})`,
    `- To: ${contract.to.role} (${contract.to.agent_type})`,
    "",
    "## Task",
    "",
    `- Type: ${contract.task.type}`,
    `- Title: ${contract.task.title}`,
    "",
    contract.task.description,
    "",
    "## Acceptance Criteria",
    "",
    ...renderList(contract.task.acceptance_criteria, "No acceptance criteria provided."),
    "",
    "## Skills",
    "",
    ...renderList(contract.task.skills ?? [], "No additional skills required."),
    "",
    "## Input Contract",
    "",
    `- Handoff file: ${contract.artifacts.handoff_file}`,
    ...renderList(contract.context.files, "No input files provided."),
    "",
    "## Output Contract",
    "",
    `- Result file: ${contract.artifacts.result_file}`,
    `- Done marker: ${contract.artifacts.done_file}`,
    "- Result JSON must be valid hydra/v2 JSON:",
    "```json",
    "{",
    `  "version": "${contract.version}",`,
    `  "handoff_id": "${contract.handoff_id}",`,
    `  "workflow_id": "${contract.workflow_id}",`,
    '  "success": true,',
    '  "summary": "Explain what changed and whether the handoff passed.",',
    '  "outputs": [{ "path": "path/to/file", "description": "Describe the output." }],',
    '  "evidence": ["npm test", "manual review"],',
    '  "next_action": {',
    '    "type": "complete",',
    '    "reason": "Why Hydra should complete, retry, or hand off next."',
    "  }",
    "}",
    "```",
    "- `next_action.type` must be one of: complete | retry | handoff",
    "- `next_action.reason` must be a non-empty string",
    "- `next_action.handoff_id` is required when next_action.type=handoff",
    "- Done marker must be valid JSON:",
    "```json",
    "{",
    `  "version": "${contract.version}",`,
    `  "handoff_id": "${contract.handoff_id}",`,
    `  "workflow_id": "${contract.workflow_id}",`,
    `  "result_file": "${contract.artifacts.result_file}"`,
    "}",
    "```",
    "",
    "## Telemetry Checks",
    "",
    "- For long-running waits, suspected stalls, or takeover/retry decisions, query telemetry instead of reading terminal prose.",
    `- Workflow snapshot: termcanvas telemetry get --workflow ${contract.workflow_id} --repo .`,
    "- Terminal snapshot when you know the active terminal ID: termcanvas telemetry get --terminal <terminalId>",
    "- Recent events when you need more detail: termcanvas telemetry events --terminal <terminalId> --limit 20",
    "- Keep waiting when telemetry shows recent meaningful progress, `thinking`, `tool_running`, `tool_pending`, or a foreground tool.",
    "- `awaiting_contract` means the model turn finished but `result.json` / `done` is still pending.",
    "- `stall_candidate` means investigate before retrying or taking over.",
    "- `error` means the agent hit an API error. Check `last_hook_error`: `rate_limit`/`server_error` → wait and retry; `billing_error`/`authentication_failed` → stop, retries won't help; `max_output_tokens` → context too long, retry with compact; `invalid_request` → stop and investigate.",
    "",
    "## Rules",
    "",
    "- Stay within this worktree/package scope.",
    "- Root cause first. Fix the real implementation problem before changing tests or fixtures.",
    "- Do not treat terminal natural language as completion evidence.",
    "- Do not hack tests, fixtures, snapshots, or mocks to satisfy the contract.",
    "- Do not fake outputs or overfit to the current data just to get a passing result.",
    "- Surface failures explicitly; do not add silent fallbacks or swallowed errors.",
    "- You must write both `result.json` and `done` before finishing.",
    `- Write the done marker JSON to ${contract.artifacts.done_file}; do not write a plain-text path.`,
    "",
    ...renderPlannerDomainGuideReference(contract.to.role, contract.artifacts.package_dir),
    ...renderEvaluatorVerificationStrategy(contract.to.role),
    ...renderEvaluatorDomainGuideReference(contract.to.role, contract.artifacts.package_dir),
  ];

  return lines.join("\n");
}

export function writeTaskPackage(contract: HandoffContract): TaskPackagePaths {
  fs.mkdirSync(contract.artifacts.package_dir, { recursive: true });
  fs.writeFileSync(
    contract.artifacts.handoff_file,
    JSON.stringify(contract, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    contract.artifacts.task_file,
    renderTaskPackageTemplate(contract),
    "utf-8",
  );
  writePlannerGuides(contract);
  writeEvaluatorGuides(contract);
  return contract.artifacts;
}
