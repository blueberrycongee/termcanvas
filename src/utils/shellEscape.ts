const SHELL_META = /[ '"()[\]{}$!&|;<>`#~*?\\]/g;

export function shellEscapePath(p: string): string {
  return p.replace(SHELL_META, (ch) => `\\${ch}`);
}
