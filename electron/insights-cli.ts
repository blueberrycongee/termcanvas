// args, to avoid E2BIG (ARG_MAX) on macOS/Linux.
const ARG_SAFE_LIMIT = 200_000;

export interface CliInvocation {
  args: string[];
  /** If set, pipe this string into the child process's stdin and close it. */
  stdin: string | null;
}

export function buildCliInvocationArgs(
  specArgs: string[],
  cliTool: "claude" | "codex",
  prompt: string,
): CliInvocation {
  if (prompt.length <= ARG_SAFE_LIMIT) {
    const cliArgs =
      cliTool === "claude"
        ? ["-p", prompt]
        : ["exec", "--skip-git-repo-check", prompt];
    return { args: [...specArgs, ...cliArgs], stdin: null };
  }

  const cliArgs =
    cliTool === "claude"
      ? ["-p", "-"]
      : ["exec", "--skip-git-repo-check", "-"];
  return { args: [...specArgs, ...cliArgs], stdin: prompt };
}
