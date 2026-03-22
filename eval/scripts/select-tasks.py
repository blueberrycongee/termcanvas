#!/usr/bin/env python3
"""Select a balanced subset of tasks for baseline evaluation."""

import json
import sys
from pathlib import Path


def count_files(patch: str) -> int:
    return patch.count("diff --git")


def count_lines(patch: str) -> int:
    count = 0
    for line in patch.split("\n"):
        if (line.startswith("+") or line.startswith("-")) and \
           not line.startswith("+++") and not line.startswith("---"):
            count += 1
    return count


def main():
    input_file = sys.argv[1] if len(sys.argv) > 1 else "tasks/swe-bench-all-multi.json"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "tasks/eval-baseline-5.json"
    n_tasks = int(sys.argv[3]) if len(sys.argv) > 3 else 5

    with open(input_file) as f:
        tasks = json.load(f)

    # Filter for moderate complexity: 3-8 files, 30-200 lines
    candidates = []
    for t in tasks:
        nf = count_files(t["patch"])
        nl = count_lines(t["patch"])
        if 3 <= nf <= 8 and 30 <= nl <= 200:
            candidates.append((t, nf, nl))

    # Sort by lines (ascending) for faster eval
    candidates.sort(key=lambda x: x[2])

    # Select diverse repos
    selected = []
    seen_repos = set()
    for task, nf, nl in candidates:
        repo = task["repo"]
        if repo not in seen_repos or len(selected) >= len(candidates) // 2:
            selected.append(task)
            seen_repos.add(repo)
        if len(selected) >= n_tasks:
            break

    # If not enough, fill from remaining
    if len(selected) < n_tasks:
        for task, nf, nl in candidates:
            if task not in selected:
                selected.append(task)
            if len(selected) >= n_tasks:
                break

    print(f"Selected {len(selected)} tasks:")
    for i, t in enumerate(selected):
        nf = count_files(t["patch"])
        nl = count_lines(t["patch"])
        ps = t["problem_statement"][:80].replace("\n", " ")
        print(f"  {i+1}. {t['instance_id']:50s} files={nf:2d} lines={nl:3d} ({ps}...)")

    with open(output_file, "w") as f:
        json.dump(selected, f, indent=2, default=str)
    print(f"\nSaved to {output_file}")


if __name__ == "__main__":
    main()
