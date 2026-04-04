export interface FontEntry {
  id: string;
  name: string;
  source: "builtin" | "google-fonts" | "github";
  url: string;
  fileName: string;
  cssFamily: string;
}

export const FONT_REGISTRY: FontEntry[] = [
  {
    id: "geist-mono",
    name: "Geist Mono",
    source: "builtin",
    url: "",
    fileName: "",
    cssFamily: '"Geist Mono"',
  },
  {
    id: "geist-pixel-square",
    name: "Geist Pixel Square",
    source: "builtin",
    url: "",
    fileName: "",
    cssFamily: '"Geist Pixel Square"',
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    source: "github",
    url: "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip",
    fileName: "JetBrainsMono-Regular.ttf",
    cssFamily: '"JetBrains Mono"',
  },
  {
    id: "fira-code",
    name: "Fira Code",
    source: "github",
    url: "https://github.com/tonsky/FiraCode/releases/download/6.2/Fira_Code_v6.2.zip",
    fileName: "FiraCode-Regular.ttf",
    cssFamily: '"Fira Code"',
  },
  {
    id: "ibm-plex-mono",
    name: "IBM Plex Mono",
    source: "github",
    url: "https://github.com/IBM/plex/releases/download/%40ibm/plex-mono%401.1.0/ibm-plex-mono.zip",
    fileName: "IBMPlexMono-Regular.ttf",
    cssFamily: '"IBM Plex Mono"',
  },
  {
    id: "hack",
    name: "Hack",
    source: "github",
    url: "https://github.com/source-foundry/Hack/releases/download/v3.003/Hack-v3.003-ttf.zip",
    fileName: "Hack-Regular.ttf",
    cssFamily: '"Hack"',
  },
];

/** Build xterm fontFamily string: selected font + fallback chain */
export function buildFontFamily(fontId: string): string {
  const entry = FONT_REGISTRY.find((f) => f.id === fontId);
  const primary = entry?.cssFamily ?? '"Geist Mono"';
  return `${primary}, "Geist Mono", Menlo, monospace`;
}
