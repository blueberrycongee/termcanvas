import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import fs from "fs";
import path from "path";
import { build as esbuild, context as esbuildCtx, type Plugin as EsbuildPlugin } from "esbuild";
import { ensureCliLauncher } from "./electron/cli-launchers";

function buildPreload(): Plugin {
  const opts = {
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
    format: "cjs" as const,
    platform: "node" as const,
    bundle: true,
    external: ["electron"],
  };
  return {
    name: "build-preload",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

/** esbuild plugin: after write, create the platform-appropriate CLI launcher. */
function cliSymlinkPlugin(outfile: string): EsbuildPlugin {
  const jsPath = path.resolve(outfile);
  return {
    name: "cli-symlink",
    setup(build) {
      build.onEnd(() => {
        ensureCliLauncher(jsPath);
      });
    },
  };
}

function buildCli(): Plugin {
  const outfile = "dist-cli/termcanvas.js";
  const opts = {
    entryPoints: ["cli/termcanvas.ts"],
    outfile,
    format: "esm" as const,
    platform: "node" as const,
    bundle: true,
    banner: { js: "#!/usr/bin/env node" },
    plugins: [cliSymlinkPlugin(outfile)],
  };
  return {
    name: "build-cli",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

function buildHydra(): Plugin {
  const outfile = "dist-cli/hydra.js";
  const opts = {
    entryPoints: ["hydra/src/cli.ts"],
    outfile,
    format: "esm" as const,
    platform: "node" as const,
    bundle: true,
    banner: { js: "#!/usr/bin/env node" },
    plugins: [cliSymlinkPlugin(outfile)],
  };
  return {
    name: "build-hydra",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

function buildBrowse(): Plugin {
  const outfile = "dist-cli/browse.js";
  const opts = {
    entryPoints: ["browse/src/cli.ts"],
    outfile,
    format: "esm" as const,
    platform: "node" as const,
    bundle: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["playwright"],
    plugins: [cliSymlinkPlugin(outfile)],
  };
  return {
    name: "build-browse",
    async buildStart() {
      if (this.meta.watchMode) {
        const ctx = await esbuildCtx(opts);
        await ctx.watch();
      } else {
        await esbuild(opts);
      }
    },
  };
}

function buildAgentShims(): Plugin {
  const shimNames = ["codex", "claude"] as const;
  const buildOptions = shimNames.map((name) => {
    const outfile = `dist-cli/agent-shims/${name}.js`;
    return {
      entryPoints: [`cli/agent-shims/${name}.ts`],
      outfile,
      format: "esm" as const,
      platform: "node" as const,
      bundle: true,
      banner: { js: "#!/usr/bin/env node" },
      plugins: [cliSymlinkPlugin(outfile)],
    };
  });

  return {
    name: "build-agent-shims",
    async buildStart() {
      fs.mkdirSync("dist-cli/agent-shims", { recursive: true });
      if (this.meta.watchMode) {
        for (const opts of buildOptions) {
          const ctx = await esbuildCtx(opts);
          await ctx.watch();
        }
      } else {
        await Promise.all(buildOptions.map((opts) => esbuild(opts)));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    buildPreload(),
    buildCli(),
    buildHydra(),
    buildBrowse(),
    buildAgentShims(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          define: {
            "process.env.VITE_SUPABASE_URL": JSON.stringify(
              process.env.VITE_SUPABASE_URL ?? "",
            ),
            "process.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
              process.env.VITE_SUPABASE_ANON_KEY ?? "",
            ),
          },
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["node-pty", "adm-zip", "@anthropic-ai/sdk"],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  base: "./",
  // Hydra writes worktrees, dispatch state, and result.json under
  // .hydra/ + .worktrees/ at runtime. The dev server's chokidar
  // watcher would otherwise see those writes, decide a "source file"
  // changed, and trigger a full renderer reload (visible as a
  // Cmd+R-style flash whenever a child Claude is dispatched). The
  // .gitignore covers git but not Vite — explicit ignore here.
  server: {
    watch: {
      ignored: [
        "**/.hydra/**",
        "**/.worktrees/**",
        "**/.hydra-result-*.md",
        "**/.hydra-task-*.md",
      ],
    },
  },
  build: {
    outDir: "dist",
  },
});
