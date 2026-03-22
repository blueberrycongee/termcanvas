#!/usr/bin/env python3
"""Update result.json files with real SWE-bench Docker test verdicts."""

import json
from pathlib import Path

RESULTS_DIR = Path(__file__).parent.parent / "results"
LOGS_DIR = Path(__file__).parent.parent / "logs" / "run_evaluation"

def get_docker_verdicts(run_id: str) -> dict[str, dict]:
    """Read all report.json files for a run and return per-task verdicts."""
    verdicts = {}
    run_log_dirs = [
        LOGS_DIR / run_id,
        RESULTS_DIR / run_id / "swebench-eval" / "logs" / "run_evaluation" / run_id,
    ]

    for run_log_dir in run_log_dirs:
        if not run_log_dir.exists():
            continue

        for model_dir in run_log_dir.iterdir():
            if not model_dir.is_dir():
                continue
            for task_dir in model_dir.iterdir():
                report = task_dir / "report.json"
                if report.exists():
                    with open(report) as f:
                        data = json.load(f)
                    for task_id, detail in data.items():
                        verdicts[task_id] = {
                            "resolved": detail.get("resolved", False),
                            "patch_applied": detail.get("patch_successfully_applied", False),
                            "patch_exists": detail.get("patch_exists", False),
                        }
    return verdicts

def update_run(run_id: str):
    """Update a run's result.json with Docker verdicts."""
    result_path = RESULTS_DIR / run_id / "result.json"
    if not result_path.exists():
        return

    verdicts = get_docker_verdicts(run_id)
    if not verdicts:
        print(f"{run_id}: no Docker verdicts found, skipping")
        return

    with open(result_path) as f:
        result = json.load(f)

    evaluated = 0
    resolved = 0
    docker_errors = 0

    for task in result["tasks"]:
        tid = task["task_id"]
        if tid in verdicts:
            v = verdicts[tid]
            task["pass"] = v["resolved"]
            task["eval_detail"] = {
                "applied": v["patch_applied"],
                "tests_passed": v["resolved"],
                "eval_method": "swebench-docker",
            }
            evaluated += 1
            if v["resolved"]:
                resolved += 1
        else:
            # No Docker verdict — mark as not evaluated (Docker build failed)
            task["pass"] = False
            task["eval_detail"] = {
                "applied": False,
                "tests_passed": False,
                "eval_method": "docker-build-failed",
            }
            docker_errors += 1

    # Recompute summary
    total = len(result["tasks"])
    result["summary"]["total"] = total
    result["summary"]["resolved"] = resolved
    result["summary"]["pass_rate"] = resolved / evaluated if evaluated > 0 else 0
    result["summary"]["evaluated"] = evaluated
    result["summary"]["docker_errors"] = docker_errors

    with open(result_path, "w") as f:
        json.dump(result, f, indent=2)

    # Also update per-task files
    tasks_dir = RESULTS_DIR / run_id / "tasks"
    if tasks_dir.exists():
        for task in result["tasks"]:
            task_file = tasks_dir / f"{task['task_id']}.json"
            if task_file.exists():
                with open(task_file, "w") as f:
                    json.dump(task, f, indent=2)

    # Update summary.json
    summary_path = RESULTS_DIR / run_id / "summary.json"
    if summary_path.exists():
        with open(summary_path, "w") as f:
            json.dump({
                "run_id": result["run_id"],
                "config": result["config"],
                "summary": result["summary"],
                "started_at": result["started_at"],
                "completed_at": result["completed_at"],
            }, f, indent=2)

    print(f"{run_id}: {resolved}/{evaluated} resolved ({docker_errors} Docker errors, {total} total)")

if __name__ == "__main__":
    for run_dir in sorted(RESULTS_DIR.iterdir()):
        if run_dir.is_dir() and (run_dir / "result.json").exists():
            update_run(run_dir.name)
