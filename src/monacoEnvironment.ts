/*
 * Monaco worker wiring for Vite.
 *
 * Monaco ships its language services as separate Web Workers
 * (editor.worker is the universal one; each of ts/json/css/html has
 * a specialized worker for IntelliSense, symbols, etc.). Without
 * this, the main thread blocks on tokenising and the editor prints
 * "worker host unreachable" errors.
 *
 * Vite's `?worker` query returns a ready-to-instantiate Worker
 * constructor for each entry, so we import them as constructors and
 * pick one based on the language label Monaco passes in.
 *
 * This module is side-effecting — importing it once (near app init)
 * installs `self.MonacoEnvironment` globally. Subsequent Monaco
 * instances pick it up automatically.
 */
// Only worker constructors — NOT the monaco core module — so
// importing this file at app init doesn't pull the ~1 MB editor
// into the main bundle. Vite's `?worker` creates separate worker
// chunks that only load when `new EditorWorker()` actually runs.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite resolves ?worker at build time; no .d.ts exists.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
// @ts-ignore
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
// @ts-ignore
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
// @ts-ignore
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
// @ts-ignore
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";

// Monaco types already declare `MonacoEnvironment` globally
// (via monaco-editor's .d.ts). We just populate it here.
self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new TsWorker();
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  },
};
