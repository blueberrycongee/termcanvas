# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are advising on the aesthetic design of an existing unread completion edge glow in TermCanvas. This is a read-only analysis task: do not modify code. Background: the feature is implemented in src/components/CompletionGlow.tsx as fixed left/right screen-edge gradients using hardcoded linear-gradient colors rgba(59,130,246,0.12) over transparent. The app has dark and light themes defined in src/index.css: dark bg #101010 with accent #0070f3, light bg #eae8e4 with accent #2563eb. The component does not branch by theme and does not use theme tokens. User observation: the glow is visible in light mode but effectively invisible in dark mode. Existing semantic language in the app: completed status uses var(--accent), e.g. in src/components/Sidebar.tsx STATUS_COLOR.completed. Question to answer: what visual treatment should this edge glow use so the semantic meaning stays as similar as possible across light and dark themes, while remaining visible in both? Please give concrete recommendations, not vague principles. Include: 1) the aesthetic rationale, 2) whether to keep blue/accent semantics or shift them, 3) suggested relative intensity for dark vs light, 4) whether a secondary hairline or shadow is appropriate, 5) one preferred CSS-ready token scheme or parameter set, and 6) any design risks to avoid so it does not read like focus/error/selection. Please write a concise but thoughtful recommendation to the result file.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-c97dd0eb3cc99564.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
