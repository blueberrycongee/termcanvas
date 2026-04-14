/**
 * After rezip-electron optimizes macOS ZIPs, the SHA-512 hashes and file
 * sizes in latest-mac.yml are stale. This script recomputes them so the
 * updater's integrity check passes.
 */
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const ymlPath = path.join("out", "latest-mac.yml");
if (!fs.existsSync(ymlPath)) process.exit(0);

const zipInfo = {};
for (const f of fs.readdirSync("out").filter((n) => n.endsWith(".zip"))) {
  const buf = fs.readFileSync(path.join("out", f));
  zipInfo[f] = {
    sha512: crypto.createHash("sha512").update(buf).digest("base64"),
    size: buf.length,
  };
}

const lines = fs.readFileSync(ymlPath, "utf8").split("\n");
let currentZip = null;

for (let i = 0; i < lines.length; i++) {
  // Match file entry:  "  - url: Foo.zip" or "    url: Foo.zip"
  const urlMatch = lines[i].match(/^(\s*(?:-\s+)?url:\s*)(.+\.zip)\s*$/);
  if (urlMatch && zipInfo[urlMatch[2]]) {
    currentZip = urlMatch[2];
    continue;
  }

  if (currentZip) {
    const shaMatch = lines[i].match(/^(\s+sha512:\s*)\S+/);
    if (shaMatch) {
      lines[i] = shaMatch[1] + zipInfo[currentZip].sha512;
      continue;
    }
    const sizeMatch = lines[i].match(/^(\s+size:\s*)\d+/);
    if (sizeMatch) {
      lines[i] = sizeMatch[1] + zipInfo[currentZip].size;
      currentZip = null;
      continue;
    }
  }

  // Top-level "path:" identifies which zip the top-level sha512 refers to
  const pathMatch = lines[i].match(/^path:\s*(.+\.zip)\s*$/);
  if (pathMatch && zipInfo[pathMatch[1]]) {
    // Update the top-level sha512 (next or nearby line starting with "sha512:")
    for (let j = i + 1; j < lines.length; j++) {
      const topSha = lines[j].match(/^(sha512:\s*)\S+/);
      if (topSha) {
        lines[j] = topSha[1] + zipInfo[pathMatch[1]].sha512;
        break;
      }
    }
  }
}

fs.writeFileSync(ymlPath, lines.join("\n"));
console.log("Updated latest-mac.yml with post-rezip hashes");
