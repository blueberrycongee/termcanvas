// Top toolbar dock height. Lives in a leaf module so that helpers
// outside the toolbar (zoom actions, fit-all math) can read it
// without pulling Toolbar.tsx — that file imports React/components,
// so making it a sibling of those helpers would risk cycles.
export const TOOLBAR_HEIGHT = 44;
