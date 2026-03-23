import { pathToFileURL } from "node:url";

export function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}
