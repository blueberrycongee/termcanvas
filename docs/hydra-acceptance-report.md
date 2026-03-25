# Hydra Acceptance Report

- Date: 2026-03-25T19:54:12.538Z
- Repo: /Users/zzzz/termcanvas
- Workflow ID: workflow-300f1340e1c0
- Mode: real TermCanvas terminal create + deterministic file evidence injection

## Reproduction

```bash
cd /Users/zzzz/termcanvas
cd hydra
npm run e2e:acceptance -- --repo /Users/zzzz/termcanvas --report /Users/zzzz/termcanvas/docs/hydra-acceptance-report.md
```

## Notes

- Each stage launched a real Claude/Codex terminal via `termcanvas terminal create --prompt`.
- The acceptance script then wrote deterministic `result.json` + `done` files to exercise the control plane without relying on model nondeterminism.
- The flow includes an evaluator failure loop and a successful recovery.

## Observed Stages

| Stage | Handoff ID | Terminal ID | Terminal Status Before Cleanup | Summary |
|------|------------|-------------|-------------------------------|---------|
| planner | handoff-3fb2473231d3 | 1774468450189-20 | running | Planner produced an actionable acceptance plan. |
| implementer | handoff-1fc446b5bd23 | 1774468450726-21 | running | Implementer completed the first pass. |
| evaluator | handoff-4a373c4b6bb2 | 1774468451244-22 | running | Evaluator found an unmet standard and requested another implementation pass. |
| implementer | handoff-1fc446b5bd23 | 1774468451756-23 | running | Implementer addressed the evaluator findings. |
| evaluator | handoff-4a373c4b6bb2 | 1774468452274-24 | running | Evaluator confirmed the recovery pass met the bar. |

## Outcome

- Sequence exercised: `planner (Claude) -> implementer (Codex) -> evaluator (Claude) -> implementer retry (Codex) -> evaluator recovery (Claude)`
- Verified: create-only dispatch, schema gate, evaluator loopback, retry/recovery, workflow completion, and cleanup.
