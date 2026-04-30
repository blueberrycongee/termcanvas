export class WorkspaceSavePathRegistry {
  private readonly allowedPaths = new Set<string>();

  constructor(
    private readonly resolvePath: (filePath: string) => string,
  ) {}

  register(filePath: string): string {
    const resolved = this.resolve(filePath);
    this.allowedPaths.add(resolved);
    return resolved;
  }

  assertAllowed(filePath: string): string {
    const resolved = this.resolve(filePath);
    if (!this.allowedPaths.has(resolved)) {
      throw new Error("Workspace save path was not selected by the user.");
    }
    return resolved;
  }

  private resolve(filePath: string): string {
    if (typeof filePath !== "string" || filePath.trim() === "") {
      throw new Error("Workspace save path is required.");
    }
    return this.resolvePath(filePath);
  }
}

