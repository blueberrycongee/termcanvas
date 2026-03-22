#!/usr/bin/env python3
"""Export eval results as SWE-bench prediction JSONL files."""

import json
import sys
from pathlib import Path

RESULTS_DIR = Path(__file__).parent.parent / "results"

def export(run_id: str):
    result_path = RESULTS_DIR / run_id / "result.json"
    with open(result_path) as f:
        result = json.load(f)

    model_name = f"termcanvas-eval-{result['config']['mode']}"
    predictions = []
    for task in result["tasks"]:
        patch = task.get("model_patch", "")
        if patch.strip():
            predictions.append({
                "instance_id": task["task_id"],
                "model_name_or_path": model_name,
                "model_patch": patch,
            })

    output_path = RESULTS_DIR / run_id / "predictions.jsonl"
    with open(output_path, "w") as f:
        for p in predictions:
            f.write(json.dumps(p) + "\n")

    print(f"{run_id}: {len(predictions)} predictions -> {output_path}")
    return str(output_path)

if __name__ == "__main__":
    run_ids = sys.argv[1:] if len(sys.argv) > 1 else [
        d.name for d in sorted(RESULTS_DIR.iterdir())
        if d.is_dir() and (d / "result.json").exists()
    ]
    for run_id in run_ids:
        export(run_id)
