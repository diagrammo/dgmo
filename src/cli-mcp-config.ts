// How `dgmo install` writes the MCP server into a JSON client config. Kept out
// of cli.ts so the shapes can be tested without running the CLI.

// Every AI client launches the server the same way: `dgmo mcp`.
export const MCP_LAUNCH = { command: 'dgmo', args: ['mcp'] } as const;

// Copilot CLI's entry (~/.copilot/mcp-config.json, or .github/mcp.json in a
// repo). Its docs show `type: "local"` and `tools: ["*"]` on every local
// server, so we write both rather than lean on the defaults.
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
export const COPILOT_MCP_ENTRY = {
  type: 'local',
  ...MCP_LAUNCH,
  tools: ['*'],
} as const;

// Set `mcpServers.dgmo` to `entry`, keeping every other key and server.
export function withDgmoMcpServer(
  cfg: Record<string, unknown>,
  entry: object
): Record<string, unknown> {
  const servers =
    (cfg['mcpServers'] as Record<string, unknown> | undefined) ?? {};
  return { ...cfg, mcpServers: { ...servers, dgmo: entry } };
}
