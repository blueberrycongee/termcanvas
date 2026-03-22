#!/usr/bin/env python3
"""Download SWE-bench dataset and filter for multi-file tasks."""

import json
import sys
import urllib.request
from pathlib import Path

import pyarrow.parquet as pq

TASKS_DIR = Path(__file__).parent.parent / "tasks"
TASKS_DIR.mkdir(exist_ok=True)

DATASETS = {
    "swe-bench": {
        "url": "https://huggingface.co/api/datasets/princeton-nlp/SWE-bench/parquet/default/test",
    },
    "swe-bench-lite": {
        "url": "https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Lite/parquet/default/test",
    },
    "swe-bench-verified": {
        "url": "https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/parquet/default/test",
    },
    "swe-bench-pro": {
        "url": "https://huggingface.co/api/datasets/ScaleAI/SWE-bench_Pro/parquet/default/test",
    },
}


def count_files_in_patch(patch: str) -> list[str]:
    """Extract file paths from a unified diff patch."""
    files = []
    for line in patch.split("\n"):
        if line.startswith("diff --git"):
            parts = line.split(" b/", 1)
            if len(parts) == 2:
                files.append(parts[1])
    return files


def count_lines_in_patch(patch: str) -> int:
    """Count added/removed lines in a patch."""
    count = 0
    for line in patch.split("\n"):
        if (line.startswith("+") or line.startswith("-")) and \
           not line.startswith("+++") and not line.startswith("---"):
            count += 1
    return count


def download_parquet(dataset_name: str) -> list[dict]:
    """Download parquet files and return as list of dicts."""
    config = DATASETS.get(dataset_name)
    if not config:
        print(f"Unknown dataset: {dataset_name}")
        sys.exit(1)

    print(f"Fetching parquet URLs for {dataset_name}...")
    with urllib.request.urlopen(config["url"]) as resp:
        urls = json.loads(resp.read())

    print(f"Found {len(urls)} parquet file(s)")

    all_rows = []
    for i, url in enumerate(urls):
        cache_path = TASKS_DIR / f"_cache_{dataset_name}_{i}.parquet"
        if not cache_path.exists():
            print(f"Downloading parquet {i+1}/{len(urls)}...")
            urllib.request.urlretrieve(url, cache_path)

        table = pq.read_table(cache_path)
        rows = table.to_pylist()
        all_rows.extend(rows)
        print(f"  Loaded {len(rows)} rows from file {i+1}")

    return all_rows


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Download and filter SWE-bench tasks")
    parser.add_argument("--dataset", default="swe-bench", choices=DATASETS.keys())
    parser.add_argument("--min-files", type=int, default=2)
    parser.add_argument("--max-tasks", type=int, default=30)
    parser.add_argument("--output", default="swe-bench-multi-file")
    parser.add_argument("--repos", nargs="*", help="Filter by repos")
    args = parser.parse_args()

    rows = download_parquet(args.dataset)
    print(f"\nTotal tasks: {len(rows)}")

    # Filter for multi-file tasks
    filtered = []
    for row in rows:
        patch = row.get("patch", "")
        files = count_files_in_patch(patch)
        if len(files) >= args.min_files:
            if args.repos and row.get("repo") not in args.repos:
                continue
            filtered.append(row)

    print(f"Multi-file tasks (>={args.min_files} files): {len(filtered)}")

    # Stratified sample across difficulty range (not just the hardest)
    filtered.sort(key=lambda r: len(count_files_in_patch(r.get("patch", ""))))
    if len(filtered) > args.max_tasks:
        step = len(filtered) / args.max_tasks
        selected = [filtered[int(i * step)] for i in range(args.max_tasks)]
    else:
        selected = filtered
    print(f"Selected: {len(selected)} tasks")

    # Show summary
    print("\nSelected tasks:")
    for i, task in enumerate(selected):
        files = count_files_in_patch(task.get("patch", ""))
        lines = count_lines_in_patch(task.get("patch", ""))
        print(f"  {i+1:3d}. {task['instance_id']:50s} files={len(files):2d} lines={lines:4d} repo={task['repo']}")

    # Save
    output_path = TASKS_DIR / f"{args.output}.json"
    with open(output_path, "w") as f:
        json.dump(selected, f, indent=2, default=str)
    print(f"\nSaved to {output_path}")


if __name__ == "__main__":
    main()
