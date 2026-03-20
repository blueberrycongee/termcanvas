export interface FontEntry {
  id: string;
  name: string;
  source: "builtin" | "google-fonts" | "github";
  /** Download URL (ignored for builtin fonts) */
  url: string;
  /** Filename stored in userData/fonts/ (ignored for builtin) */
  fileName: string;
  /** CSS font-family value to pass to xterm */
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
    source: "google-fonts",
    url: "https://fonts.google.com/download?family=JetBrains+Mono",
    fileName: "JetBrainsMono-Regular.ttf",
    cssFamily: '"JetBrains Mono"',
  },
  {
    id: "fira-code",
    name: "Fira Code",
    source: "google-fonts",
    url: "https://fonts.google.com/download?family=Fira+Code",
    fileName: "FiraCode-Regular.ttf",
    cssFamily: '"Fira Code"',
  },
  {
    id: "source-code-pro",
    name: "Source Code Pro",
    source: "google-fonts",
    url: "https://fonts.google.com/download?family=Source+Code+Pro",
    fileName: "SourceCodePro-Regular.ttf",
    cssFamily: '"Source Code Pro"',
  },
  {
    id: "ibm-plex-mono",
    name: "IBM Plex Mono",
    source: "google-fonts",
    url: "https://fonts.google.com/download?family=IBM+Plex+Mono",
    fileName: "IBMPlexMono-Regular.ttf",
    cssFamily: '"IBM Plex Mono"',
  },
  {
    id: "inconsolata",
    name: "Inconsolata",
    source: "google-fonts",
    url: "https://fonts.google.com/download?family=Inconsolata",
    fileName: "Inconsolata-Regular.ttf",
    cssFamily: '"Inconsolata"',
  },
  {
    id: "cascadia-code",
    name: "Cascadia Code",
    source: "github",
    url: "https://github.com/microsoft/cascadia-code/releases/latest/download/CascadiaCode-2404.23.zip",
    fileName: "CascadiaCode-Regular.otf",
    cssFamily: '"Cascadia Code"',
  },
  {
    id: "hack",
    name: "Hack",
    source: "github",
    url: "https://github.com/source-foundry/Hack/releases/latest/download/Hack-v3.003-ttf.zip",
    fileName: "Hack-Regular.ttf",
    cssFamily: '"Hack"',
  },
  {
    id: "victor-mono",
    name: "Victor Mono",
    source: "github",
    url: "https://github.com/rubjo/victor-mono/releases/latest/download/VictorMonoAll.zip",
    fileName: "VictorMono-Regular.ttf",
    cssFamily: '"Victor Mono"',
  },
];

/** Build xterm fontFamily string: selected font + fallback chain */
export function buildFontFamily(fontId: string): string {
  const entry = FONT_REGISTRY.find((f) => f.id === fontId);
  const primary = entry?.cssFamily ?? '"Geist Mono"';
  return `${primary}, "Geist Mono", Menlo, monospace`;
}
