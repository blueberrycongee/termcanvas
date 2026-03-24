# Black Screen Issue Investigation

## Problem

Starting from v0.8.10, every packaged version (v0.8.10 ~ v0.8.15) shows a black screen on launch. The last known working packaged version is v0.8.7.

Dev mode (`npm run dev`) works perfectly on all versions.

## Timeline

- v0.8.7: last working packaged version (installed and confirmed working)
- v0.8.8: version bump + changelog only (not installed via DMG)
- v0.8.9: version bump only
- v0.8.10: first confirmed black screen after DMG install
- v0.8.11 ~ v0.8.15: all black screen

## Investigation

### What works

- **Dev mode**: `npm run dev` renders correctly on the same codebase
- **Code logic**: `loadFile(path.join(__dirname, "../dist/index.html"))` path is correct
- **Asar contents**: `dist/index.html`, `dist/assets/index-*.js`, `dist/assets/index-*.css` all present with correct sizes (~900KB JS, ~37KB CSS)
- **React rendering**: Manually loading the extracted asar in a test Electron harness confirmed React renders the full UI (title bar, buttons, canvas) — the HTML `<div id="root">` contains the full component tree
- **Main process**: No errors. `[TermCanvas API]` prints successfully, meaning `did-finish-load` fires
- **Preload script**: `preload.cjs` exists and loads

### What fails

- **Production `BrowserWindow`** shows black/empty window despite `ready-to-show` + `show()` pattern
- The renderer process does NOT appear in `ELECTRON_ENABLE_LOGGING` output for production builds (no `[CONSOLE]` lines from the renderer)

### Root cause hypothesis

The window appears but the renderer content is not composited/painted to screen. Possible causes:

1. **macOS Gatekeeper / code signing**: DMG-installed unsigned app may have translucency layer issues. The `xattr -cr` (remove quarantine) sometimes helps.

2. **GPU compositing**: Electron's GPU-accelerated compositor may fail silently on certain macOS + GPU combinations. `--disable-gpu-compositing` is a known workaround.

3. **Electron version mismatch**: If the Electron version was bumped between v0.8.7 and v0.8.10, the newer Electron may have a regression.

4. **`show: false` + `ready-to-show` timing**: The window may fire `ready-to-show` before the renderer has painted. However, this is unlikely since the same code works in dev mode.

5. **`backgroundColor: "#101010"`**: This is the Electron window background. If the renderer fails to paint, users see this dark color — appearing as a "black screen."

## Workarounds tried

| Workaround | Result |
|---|---|
| Clear all caches (Cache, Code Cache, GPUCache, Dawn*) | No effect |
| `xattr -cr /Applications/TermCanvas.app` | Pending verification |
| `--disable-gpu-compositing` | Pending verification |
| Kill all processes + fresh launch | No effect |
| Multiple version reinstalls | No effect |

## Next steps

1. Check if `--disable-gpu-compositing` resolves the issue
2. Compare Electron version between v0.8.7 and v0.8.10+ in `package.json` history
3. If GPU compositing is the fix, add it as a default flag in `electron-builder` config or main process
4. Consider adding a `webContents.on('render-process-gone')` handler for diagnostics
5. Check if `electron-builder` config changed between v0.8.7 and v0.8.10
