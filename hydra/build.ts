import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/hydra.js",
  banner: { js: "#!/usr/bin/env node" },
});

// Copy builtin role files alongside the bundle so the role loader can read
// them at runtime. The loader looks under dist/roles/builtin when running
// from a bundled binary.
const builtinSrc = path.resolve("src/roles/builtin");
const builtinDest = path.resolve("dist/roles/builtin");
if (fs.existsSync(builtinSrc)) {
  fs.mkdirSync(builtinDest, { recursive: true });
  for (const entry of fs.readdirSync(builtinSrc)) {
    if (!entry.endsWith(".md")) continue;
    fs.copyFileSync(path.join(builtinSrc, entry), path.join(builtinDest, entry));
  }
}
