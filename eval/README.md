# Hydra Evaluation Framework

Evaluation pipeline for measuring Hydra multi-agent orchestration effectiveness against single-agent baselines, using SWE-bench Docker test harness.

## Overview

This framework runs coding tasks from SWE-bench against different agent configurations, then validates results using SWE-bench's Docker harness (FAIL_TO_PASS test execution).

```
Supported modes:
┌──────────────────────────────────────────────────┐
│ single-claude  │ One Claude Code agent            │
│ single-codex   │ One Codex agent                  │
│ hydra          │ Hydra multi-agent orchestration   │
└──────────────────────────────────────────────────┘
```

## Two-Phase Evaluation

```
Phase 1: Agent Run
  eval run --mode single-claude --tasks tasks/swe-bench-multi-file.json
  → Agent generates patches, saved to results/<run_id>/

Phase 2: SWE-bench Docker Evaluation
  python3 scripts/export-predictions.py <run_id>
  DOCKER_HOST=... python3 -m swebench.harness.run_evaluation \
    --predictions_path results/<run_id>/predictions.jsonl \
    --dataset_name princeton-nlp/SWE-bench --run_id <run_id>
  python3 scripts/update-results-with-swebench.py
  → Real pass/fail from test execution updates results/
```

## Quick Start

```bash
cd eval
npm install
pip install swebench pyarrow

# Download task set
python3 scripts/download-dataset.py --min-files 3 --max-tasks 20

# Phase 1: Run agents
node --experimental-strip-types --no-warnings src/cli.ts run \
  --mode single-claude \
  --tasks tasks/swe-bench-multi-file.json \
  --timeout 1800

# Phase 2: Evaluate with SWE-bench Docker
python3 scripts/export-predictions.py <run_id>
DOCKER_HOST=unix:///path/to/docker.sock \
  python3 -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench \
  --predictions_path results/<run_id>/predictions.jsonl \
  --max_workers 2 --run_id <run_id> --cache_level env
python3 scripts/update-results-with-swebench.py

# Compare runs
node --experimental-strip-types --no-warnings src/cli.ts compare <run_a> <run_b>
node --experimental-strip-types --no-warnings src/cli.ts list
```

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--mode` | Agent mode: `single-claude`, `single-codex`, `hydra` | `single-claude` |
| `--tasks` | Path to task JSON file | auto-download |
| `--prompt-version` | Prompt version tag for tracking | `v1` |
| `--run-id` | Custom run identifier | auto-generated |
| `--timeout` | Per-task timeout in seconds | `600` |
| `--max-tasks` | Limit number of tasks to run | all |
| `--max-workers` | Parallel task execution | `1` |
| `--orchestrator` | Hydra orchestrator model | `claude` |
| `--sub-agents` | Hydra sub-agent types (comma-separated) | `claude,codex` |

## Task Sets

Task files are not checked into the repo — generate them with `scripts/download-dataset.py`:

```bash
# SWE-bench Pro (recommended — multi-file, multi-language, pollution-resistant)
python3 scripts/download-dataset.py --dataset swe-bench-pro --max-tasks 50 --output pro-50

# SWE-bench Full, stratified sample of multi-file tasks
python3 scripts/download-dataset.py --dataset swe-bench --min-files 3 --max-tasks 30 --output multi-file-30

# SWE-bench Verified (deprecated by OpenAI, not recommended)
python3 scripts/download-dataset.py --dataset swe-bench-verified --max-tasks 50 --output verified-50
```

Available datasets: `swe-bench`, `swe-bench-verified`, `swe-bench-pro`

## Architecture

```
eval/
  src/
    cli.ts              CLI entry point
    runner.ts           Orchestrates evaluation runs (Phase 1)
    types.ts            Type definitions
    dataset.ts          SWE-bench task loading and filtering
    evaluator.ts        SWE-bench Docker integration
    results.ts          Result storage and loading
    compare.ts          Cross-run comparison
    agents/
      single.ts         Claude Code / Codex single-agent runner
      hydra.ts          Hydra multi-agent runner (direct + TermCanvas)
  scripts/
    download-dataset.py         Download SWE-bench from HuggingFace
    export-predictions.py       Convert results to SWE-bench JSONL
    run-swebench-eval.py        Run SWE-bench Docker evaluation
    update-results-with-swebench.py  Merge Docker verdicts into results
    select-tasks.py             Select balanced task subsets
  tasks/                Task definitions (JSON)
  results/              Run results (JSON, updated with Docker verdicts)
  logs/                 SWE-bench Docker evaluation logs + reports
```

## Development

```bash
npm run typecheck
node --experimental-strip-types --no-warnings --test tests/*.test.ts
```
