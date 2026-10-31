import { describe, it, expect } from 'vitest';
import {
  COPILOT_MCP_ENTRY,
  MCP_LAUNCH,
  withDgmoMcpServer,
} from '../src/cli-mcp-config';

describe('withDgmoMcpServer', () => {
  it('keeps the other servers and top-level keys', () => {
    const cfg = {
      theme: 'dark',
      mcpServers: { playwright: { type: 'local', command: 'npx' } },
    };
    expect(withDgmoMcpServer(cfg, MCP_LAUNCH)).toEqual({
      theme: 'dark',
      mcpServers: {
        playwright: { type: 'local', command: 'npx' },
        dgmo: { command: 'dgmo', args: ['mcp'] },
      },
    });
  });

  it('replaces an existing dgmo entry, such as a hand-written http one', () => {
    const cfg = {
      mcpServers: { dgmo: { type: 'http', url: 'http://127.0.0.1:3333/mcp' } },
    };
    expect(withDgmoMcpServer(cfg, COPILOT_MCP_ENTRY).mcpServers).toEqual({
      dgmo: COPILOT_MCP_ENTRY,
    });
  });

  it('creates mcpServers in an empty config', () => {
    expect(withDgmoMcpServer({}, MCP_LAUNCH)).toEqual({
      mcpServers: { dgmo: MCP_LAUNCH },
    });
  });
});

// Copilot CLI's documented local-server shape.
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
describe('COPILOT_MCP_ENTRY', () => {
  it('is a local server that runs dgmo mcp with every tool', () => {
    expect(COPILOT_MCP_ENTRY).toEqual({
      type: 'local',
      command: 'dgmo',
      args: ['mcp'],
      tools: ['*'],
    });
  });
});
