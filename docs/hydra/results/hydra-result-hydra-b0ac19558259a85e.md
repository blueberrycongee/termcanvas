# Review Result

## Files changed and why

- `.hydra-result-hydra-b0ac19558259a85e.md`: captured the requested review findings and recommendations.

## Issues found

### 1. High: the proposed `installed_plugins.json` handling can destroy unrelated user plugin state

The plan's Task 5 helper does this:

- `readInstalledPlugins()` returns `{ version: 2, plugins: {} }` on any parse failure
- `installSkillLinks()` then writes that object back to `~/.claude/plugins/installed_plugins.json`

Because `ensureSkillLinks()` is called on every startup, a malformed or truncated `installed_plugins.json` would cause TermCanvas to silently overwrite the entire file and drop every other installed Claude plugin. That is not migration-safe.

The helper is also not schema-safe: if the JSON parses but `plugins` is missing or not an object, `data.plugins[PLUGIN_KEY] = ...` can throw or produce invalid shape.

Recommendation:

- Do not silently replace the whole file on parse failure.
- Treat malformed JSON as a recoverable error: log, skip mutation, and return `false`.
- Validate `version` and `plugins` shape before writing.
- Write atomically via temp file + rename.

### 2. High: the plan does not actually deliver a Claude `/rename` skill

The design doc says the feature will be invoked as `/rename`, but Claude plugin skills are namespaced. Anthropic's plugin docs show plugin skills are invoked as `/plugin-name:skill-name`, for example `/my-first-plugin:hello`, and explicitly note that namespacing is part of the plugin model.

With the proposed plugin layout, Claude users would get `/termcanvas:rename`, not `/rename`.

Recommendation:

- Update the design and implementation plan to match the real UX, or
- keep a standalone Claude skill at `~/.claude/skills/rename` if `/rename` is a hard requirement, or
- add a slash-command wrapper if Claude supports a command-based alias that calls the skill.

### 3. High: the new `ensureSkillLinks()` is not idempotent and regresses the current behavior

Current code in [`electron/hydra-skill.ts`](/Users/zzzz/termcanvas/electron/hydra-skill.ts) has a real no-op path in `ensureHydraSkillLinks()`: it checks `readlinkSync(link) === sourceDir` and skips work when already current.

The proposed replacement removes that property and makes:

- `ensureSkillLinks()` call `installSkillLinks()` unconditionally
- Claude plugin metadata rewrite on every startup
- Codex symlinks get unlinked and recreated on every startup
- `installedAt` and `lastUpdated` change on every startup

That is not idempotent in the practical sense the task asks for. It also increases the chance of partial state if one unlink/symlink/write fails mid-run.

Recommendation:

- Keep an explicit `ensure` path that only mutates when the current install path/version is stale.
- For Codex, compare each existing symlink target before replacing it.
- For Claude, only rewrite `installed_plugins.json` when the entry actually changed.

### 4. Medium: manifest/version handling is inconsistent and weak for update safety

The docs plan says the plugin manifest should contain a version, but Task 1's example `skills/.claude-plugin/plugin.json` omits `version`. Later, the proposed installer writes `"version": "1.0.0"` into `installed_plugins.json` regardless of the app version.

That creates two problems:

- plugin metadata is internally inconsistent
- content updates are hard to reason about because the plugin version never changes even when the bundled skill content changes

On the filesystem side, using `installPath` that points at app resources should usually track in-place app replacement correctly. The current mac updater replaces the `.app` bundle at the same path, so `/Applications/TermCanvas.app/Contents/Resources/skills` should point to new content after update. But the plan still relies on Claude re-reading a mutable plugin directory whose recorded version never changes.

Recommendation:

- Put the real app version into `.claude-plugin/plugin.json`.
- Derive the installed plugin version from `app.getVersion()`, not a hardcoded literal.
- Only update `lastUpdated` when the source path or version changed.
- Verify with a real Claude install/restart or `/reload-plugins` test, not only file inspection.

### 5. Medium: plugin key handling can clobber existing entries and uninstall too much

The proposed code blindly assigns:

`data.plugins[PLUGIN_KEY] = [ ... ]`

and blindly deletes:

`delete data.plugins[PLUGIN_KEY]`

`installed_plugins.json` stores arrays per key, and the observed file already contains multiple scopes and plugin owners. If the same key already exists for another scope or install source, this code overwrites it. On uninstall, it removes every entry under that key.

Recommendation:

- Merge only the specific TermCanvas user-scope entry instead of replacing the whole array.
- Preserve unrelated entries under the same key if they exist.
- Decide the key format deliberately and document it; the current `termcanvas@termcanvas` choice is arbitrary and may conflict later.

### 6. Medium: migration cleanup is too narrow and leaves duplicate-skill edge cases unresolved

The plan only removes the old Claude hydra symlink when `readlinkSync(oldClaudeHydra)` contains `"Resources/skill"`.

That misses several realistic cases:

- the old path is a symlink written in a different form
- the user replaced the symlink with a directory
- the symlink points to copied or user-modified content

In those cases, the old standalone `hydra` skill remains alongside the new plugin-provided `hydra` skill. Anthropic's migration docs recommend removing original `.claude` files after migration to avoid duplicates.

Recommendation:

- Detect whether the old path is a symlink, directory, or file before deciding what to do.
- Remove only links that TermCanvas previously owned.
- If a user-modified standalone Hydra skill exists, do not delete it silently; log or surface a migration warning because duplicate `hydra` definitions are ambiguous.

### 7. Medium: Codex fallback is sufficient for current SKILL-only content, but the plan should say that explicitly

For the current scope, the Codex fallback is sufficient:

- Codex today uses `~/.codex/skills/<name>/SKILL.md`
- the proposed per-skill symlinks point directly at `sourceDir/skills/<name>`
- both planned skills (`hydra`, `rename`) are pure SKILL.md content

So this is adequate for now. But it is not general plugin parity. Anything outside `skills/` would not carry over to Codex.

Recommendation:

- Keep the Codex fallback exactly for `skills/`.
- Document that Claude gets plugin behavior, while Codex gets skill-only compatibility.
- Generate uninstall cleanup dynamically from the plugin's `skills/` directory instead of hardcoding `["hydra", "rename"]`.

### 8. Medium: conflict handling for existing Codex skill paths is brittle

The proposed Codex install loop unconditionally does `unlinkSync(link)` and then `symlinkSync(...)`. If `~/.codex/skills/hydra` or `rename` is a real directory or regular file, `unlinkSync()` fails and the outer `try/catch` aborts the entire install.

That means one user-created conflicting skill path can break both the Claude plugin registration path and all Codex skill updates on every startup.

Recommendation:

- Handle symlink/file/directory cases separately.
- Only replace TermCanvas-owned symlinks automatically.
- Skip conflicting user-managed paths and report them instead of failing the whole install.

## Overall assessment

The direction is reasonable, but the current plan is not safe enough to implement as written. The biggest gaps are:

- unsafe mutation of `installed_plugins.json`
- loss of startup idempotency compared with the current implementation
- a real UX mismatch between the promised `/rename` command and Claude plugin namespacing

The app-resource `installPath` approach can plausibly give automatic skill content updates across in-place app upgrades, but only if the plugin metadata/versioning and runtime reload behavior are handled more carefully than the plan currently describes.

## Whether tests pass

- No tests were run. This was a design/implementation-plan review only.

## Unresolved problems

- I did not verify Claude Code's internal behavior for manually injected `installed_plugins.json` entries pointing outside `~/.claude/plugins/cache`; the plan relies on that undocumented mechanism.
- I did verify the current local plugin structure and local Claude plugin docs, and those are enough to conclude the `/rename` naming mismatch and the state-file/idempotency risks above.
