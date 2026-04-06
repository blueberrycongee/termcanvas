# File Tree Git Status Badges Design

## Problem

The left panel file tree does not show git status indicators. Users cannot
tell which files are modified, untracked, or staged without switching to
the Git tab.

## Solution

Add VS Code-style single-letter badges (M, U, A, D, R, C) to the right
side of each file entry in `FilesContent.tsx`, consuming the existing
`useGitStatus` hook and `leftPanelRepoStore` cache.

## Badge Mapping

| Git Status | Badge | Color | Hex |
|---|---|---|---|
| Modified (M) | M | Yellow | #e2b93d |
| Untracked (?) | U | Green | #73c991 |
| Added (A) | A | Green | #73c991 |
| Deleted (D) | D | Red | #e06c75 |
| Renamed (R) | R | Green | #73c991 |
| Copied (C) | C | Green | #73c991 |
| Conflict (U) | U | Red | #e06c75 |

## Folder Behavior

Folders with changed descendants show a small dot indicator (not a letter)
in the highest-priority status color. Priority: conflict > deleted >
modified > added/untracked.

## Data Flow

```
GitFileWatcher (.git/index changes)
  → git:status IPC
  → leftPanelRepoStore cache
  → useGitStatus hook (already exists)
  → FilesContent.tsx builds Map<relativePath, GitFileStatus>
  → Each tree item renders badge if status exists
```

## Changes Required

1. `src/components/LeftPanel/FilesContent.tsx` — consume git status,
   render badges on file items and dot indicators on folders
2. No new IPC channels, hooks, or stores needed

## Non-git Repos

`useGitStatus` returns empty array for non-git directories. No badges
render. No conditional checks needed.
