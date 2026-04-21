import { spawnSync } from "node:child_process";

function isProductionOnlyInstall() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.npm_config_production === "true") return true;
  if (process.env.npm_config_only === "prod") return true;

  const omit = process.env.npm_config_omit ?? "";
  return omit
    .split(",")
    .map((entry) => entry.trim())
    .includes("dev");
}

function run(bin, args) {
  const result = spawnSync(bin, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

if (isProductionOnlyInstall()) {
  console.log("[postinstall] Skipping desktop dependency setup for production-only install");
  process.exit(0);
}

run("electron-builder", ["install-app-deps"]);
run("playwright", ["install", "chromium"]);
