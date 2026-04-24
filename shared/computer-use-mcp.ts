export type ComputerUseMcpProvider = "claude" | "codex";

export interface ComputerUseMcpConfigOptions {
  mcpServerPath: string;
  stateFilePath: string;
}

export function isComputerUseMcpProvider(
  value: string,
): value is ComputerUseMcpProvider {
  return value === "claude" || value === "codex";
}

function buildComputerUseMcpServerConfig({
  mcpServerPath,
  stateFilePath,
}: ComputerUseMcpConfigOptions) {
  return {
    command: "node",
    args: [mcpServerPath],
    env: {
      TERMCANVAS_COMPUTER_USE_STATE_FILE: stateFilePath,
    },
  };
}

function getCodexMcpConfigArgs(options: ComputerUseMcpConfigOptions): string[] {
  return [
    "-c",
    'mcp_servers.computer-use.command="node"',
    "-c",
    `mcp_servers.computer-use.args=${JSON.stringify([options.mcpServerPath])}`,
    "-c",
    `mcp_servers.computer-use.env=${JSON.stringify({
      TERMCANVAS_COMPUTER_USE_STATE_FILE: options.stateFilePath,
    })}`,
  ];
}

function getClaudeMcpConfigArgs(options: ComputerUseMcpConfigOptions): string[] {
  return [
    "--mcp-config",
    JSON.stringify({
      mcpServers: {
        "computer-use": buildComputerUseMcpServerConfig(options),
      },
    }),
  ];
}

export function getComputerUseMcpConfigArgs(
  provider: ComputerUseMcpProvider,
  options: ComputerUseMcpConfigOptions,
): string[] {
  if (provider === "claude") {
    return getClaudeMcpConfigArgs(options);
  }
  return getCodexMcpConfigArgs(options);
}
