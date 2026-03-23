# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review the implementation plan at docs/plans/2026-03-23-terminal-rename-implementation.md and the design doc at docs/plans/2026-03-23-terminal-rename-design.md for the terminal rename feature. Also read the current implementation: electron/hydra-skill.ts, electron/main.ts (search for installSkill/ensureSkill/getSkillSourceDir), hydra/skill/SKILL.md, and ~/.claude/plugins/installed_plugins.json.

Focus your review on these specific concerns:

1. **Migration safety**: New users installing for the first time AND existing users updating from the old hydra-only symlink mechanism (~/.claude/skills/hydra -> app resources) must both work. The new plugin-based mechanism must cleanly replace the old symlink.

2. **Idempotency**: install/ensure functions are called on every app startup. They must be safe to run repeatedly.

3. **Skill content auto-update**: When users update the app (new version download), skill content (SKILL.md) should automatically reflect the new version. The plan uses installPath pointing to app resources — verify this works across updates.

4. **Codex compatibility**: Codex uses ~/.codex/skills/ with individual symlinks as fallback since it may not support Claude Code plugin mechanism. Is this sufficient?

5. **Edge cases**: Malformed installed_plugins.json? Conflicting plugin keys? Old hydra symlink pointing to user-modified content? App resources path changing between versions?

6. **Any other issues** in the plan.

Be critical. Write your review to the result file with specific issues and recommendations.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-b0ac19558259a85e.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
