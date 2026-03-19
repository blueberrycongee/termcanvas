# Composer Drag & Drop Design

## Goal

Add drag-and-drop file support to the Composer bar. Dragged image files go through the existing image attachment pipeline; non-image files insert their absolute path into the draft text.

## Interaction

1. **Drag hover** — When files enter the Composer outer container (`div.rounded-xl`), the border changes to accent color and a hint overlay appears ("Drop files here").
2. **Drop — image files** (png/jpg/gif/webp) — Converted to `ComposerImageAttachment` via `FileReader.readAsDataURL`, added to store via `addImages`. If target terminal does not support images, show a warning notification and reject.
3. **Drop — non-image files** — Their absolute paths are inserted into the draft text at the current cursor position, space-separated for multiple files.
4. **Drag leave / drop** — Remove visual highlight.

## Approach

Drop zone is the Composer outer `div.rounded-xl` container (option C), not just the textarea and not the entire window.

## Changes

| File | Change |
|------|--------|
| `ComposerBar.tsx` | Add `onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` on outer div; `isDragOver` state for highlight; drop handler splits files by image vs non-image |
| `composerStore.ts` | No change — reuse `addImages` and `setDraft` |
| `composer-submit.ts` | No change |
| i18n files | Add `composer_drop_hint` translation key |

## File type detection

Use `file.type.startsWith("image/")` for image detection, consistent with the existing clipboard paste logic in `handleImagePaste`.

## Path format

All non-image files use absolute paths (`file.path` from Electron's drag-and-drop API), regardless of terminal type.
