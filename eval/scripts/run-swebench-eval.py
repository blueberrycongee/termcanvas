#!/usr/bin/env python3
"""
Run SWE-bench Docker evaluation on eval framework predictions.
Converts our result.json to SWE-bench predictions format and runs the harness.
"""

import json
import sys
import os
from pathlib import Path

def load_run_result(run_id: str) -> dict:
    """Load a run result from the eval results directory."""
    result_path = Path(__file__).parent.parent / "results" / run_id / "result.json"
    with open(result_path) as f:
        return json.load(f)

def to_predictions(result: dict, model_name: str) -> list[dict]:
    """Convert run result to SWE-bench prediction format."""
    predictions = []
    for task in result["tasks"]:
        patch = task.get("model_patch", "")
        if patch.strip():
            predictions.append({
                "instance_id": task["task_id"],
                "model_name_or_path": model_name,
                "model_patch": patch,
            })
    return predictions

def write_predictions_jsonl(predictions: list[dict], output_path: str):
    """Write predictions to JSONL file."""
    with open(output_path, "w") as f:
        for pred in predictions:
            f.write(json.dumps(pred) + "\n")
    print(f"Wrote {len(predictions)} predictions to {output_path}")

DATASET_MAP = {
    "swe-bench": "princeton-nlp/SWE-bench",
    "swe-bench-lite": "SWE-bench/SWE-bench_Lite",
    "swe-bench-verified": "SWE-bench/SWE-bench_Verified",
    "swe-bench-pro": "ScaleAI/SWE-bench_Pro",
}

def run_evaluation(predictions_path: str, run_id: str, benchmark: str = "swe-bench", max_workers: int = 4):
    """Run SWE-bench evaluation."""
    output_dir = Path(__file__).parent.parent / "results" / run_id / "swebench-eval"
    output_dir.mkdir(parents=True, exist_ok=True)

    dataset_name = DATASET_MAP.get(benchmark, "princeton-nlp/SWE-bench")

    print(f"\nRunning SWE-bench evaluation for {run_id}...")
    print(f"Dataset: {dataset_name}")
    print(f"Predictions: {predictions_path}")
    print(f"Output: {output_dir}")
    print(f"Workers: {max_workers}")
    print()

    import subprocess
    cmd = [
        "python3", "-m", "swebench.harness.run_evaluation",
        "--dataset_name", dataset_name,
        "--predictions_path", predictions_path,
        "--max_workers", str(max_workers),
        "--run_id", run_id,
        "--cache_level", "env",
    ]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(output_dir))

def parse_results(run_id: str) -> dict:
    """Parse SWE-bench evaluation results and update the run result."""
    output_dir = Path(__file__).parent.parent / "results" / run_id / "swebench-eval"

    # Look for results files
    results = {}
    for f in output_dir.glob("*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                for instance_id, detail in data.items():
                    if isinstance(detail, dict) and "resolved" in detail:
                        results[instance_id] = detail["resolved"]
        except:
            pass

    # Also check for the log-based results
    for log_dir in output_dir.glob("*/"):
        if log_dir.is_dir():
            for log_file in log_dir.glob("*.log"):
                # Parse test results from logs
                pass

    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: run-swebench-eval.py <run_id> [--max-workers N]")
        print("\nAvailable runs:")
        results_dir = Path(__file__).parent.parent / "results"
        for d in sorted(results_dir.iterdir()):
            if d.is_dir() and (d / "result.json").exists():
                with open(d / "result.json") as f:
                    r = json.load(f)
                tasks_with_patch = sum(1 for t in r["tasks"] if t.get("model_patch", "").strip())
                print(f"  {d.name:30s} tasks={len(r['tasks']):2d}  with_patch={tasks_with_patch:2d}  mode={r['config']['mode']}")
        sys.exit(1)

    run_id = sys.argv[1]
    max_workers = 4
    if "--max-workers" in sys.argv:
        idx = sys.argv.index("--max-workers")
        max_workers = int(sys.argv[idx + 1])

    # Load and convert
    result = load_run_result(run_id)
    model_name = f"termcanvas-eval-{result['config']['mode']}"
    predictions = to_predictions(result, model_name)

    if not predictions:
        print(f"No predictions with patches found in {run_id}")
        sys.exit(1)

    print(f"Run: {run_id}")
    print(f"Mode: {result['config']['mode']}")
    print(f"Tasks with patches: {len(predictions)}/{len(result['tasks'])}")

    # Write predictions
    pred_path = str(Path(__file__).parent.parent / "results" / run_id / "predictions.jsonl")
    write_predictions_jsonl(predictions, pred_path)

    # Run evaluation
    benchmark = result.get("config", {}).get("benchmark", "swe-bench")
    run_evaluation(pred_path, run_id, benchmark, max_workers)

    print("\nDone. Check results in:")
    print(f"  {Path(__file__).parent.parent / 'results' / run_id / 'swebench-eval'}")

if __name__ == "__main__":
    main()
