export type ComputerUseMcpProvider = "claude" | "codex";

export interface ComputerUseMcpConfigOptions {
  mcpServerPath: string;
  stateFilePath: string;
  instructionsFilePath?: string;
}

type ComputerUseMcpEnvOptions = Pick<
  ComputerUseMcpConfigOptions,
  "stateFilePath" | "instructionsFilePath"
>;

export function isComputerUseMcpProvider(
  value: string,
): value is ComputerUseMcpProvider {
  return value === "claude" || value === "codex";
}

function buildComputerUseMcpServerEnv({
  stateFilePath,
  instructionsFilePath,
}: ComputerUseMcpEnvOptions): Record<string, string> {
  const env: Record<string, string> = {
    TERMCANVAS_COMPUTER_USE_STATE_FILE: stateFilePath,
  };
  if (instructionsFilePath) {
    env.TERMCANVAS_COMPUTER_USE_INSTRUCTIONS = instructionsFilePath;
  }
  return env;
}

function buildComputerUseMcpServerConfig({
  mcpServerPath,
  ...options
}: ComputerUseMcpConfigOptions) {
  return {
    command: "node",
    args: [mcpServerPath],
    env: buildComputerUseMcpServerEnv(options),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values).map(
    ([key, value]) => `${key} = ${tomlString(value)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

function getCodexMcpConfigArgs(options: ComputerUseMcpConfigOptions): string[] {
  return [
    "-c",
    'mcp_servers.computer-use.command="node"',
    "-c",
    `mcp_servers.computer-use.args=${JSON.stringify([options.mcpServerPath])}`,
    "-c",
    `mcp_servers.computer-use.env=${tomlInlineTable(buildComputerUseMcpServerEnv(options))}`,
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
