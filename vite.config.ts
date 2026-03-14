import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "path";
import { build as esbuild, context as esbuildCtx } from "esbuild";

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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    buildPreload(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["node-pty"],
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
  build: {
    outDir: "dist",
  },
});
