// How `dgmo install opencode` writes the dgmo MCP server into OpenCode's
// config (diagrammo/diagrammo#2379). Kept out of cli.ts so the shapes can be
// tested without running the CLI.
//
// OpenCode 2.x keeps MCP servers under `mcp.servers.<name>`, a local one as
// `{ type: "local", command: [...] }` with the arguments in the array. That is
// what `opencode mcp add dgmo -- dgmo mcp` itself writes (opencode 2.4.2,
// probed 2026-11-26) and the shape the app's AI panel hands OpenCode
// (diagrammo-app/src-tauri/src/pty.rs, `opencode_config`).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_LAUNCH } from './cli-mcp-config';

export const OPENCODE_MCP_ENTRY = {
  type: 'local',
  command: [MCP_LAUNCH.command, ...MCP_LAUNCH.args],
} as const;

// OpenCode's user config folder: `$XDG_CONFIG_HOME/opencode`, else
// `~/.config/opencode` (`opencode debug paths`, opencode 2.4.2).
export function opencodeConfigDir(
  home: string,
  env: NodeJS.ProcessEnv
): string {
  const xdg = env['XDG_CONFIG_HOME'];
  return join(xdg && xdg.length > 0 ? xdg : join(home, '.config'), 'opencode');
}

// The file to write in `dir`: `opencode.json` when it exists, else an existing
// `opencode.jsonc`, else a new `opencode.json`.
export function opencodeConfigFile(dir: string): string {
  const json = join(dir, 'opencode.json');
  const jsonc = join(dir, 'opencode.jsonc');
  if (!existsSync(json) && existsSync(jsonc)) return jsonc;
  return json;
}

// The end of the string literal opening at `raw[i]`, escapes included.
function stringEnd(raw: string, i: number): number {
  let j = i + 1;
  while (j < raw.length && raw[j] !== '"') j += raw[j] === '\\' ? 2 : 1;
  return j + 1;
}

// `raw` without its `//` and `/* */` comments. Strings are copied untouched.
function stripComments(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      const end = stringEnd(raw, i);
      out += raw.slice(i, end);
      i = end;
    } else if (raw.startsWith('//', i)) {
      while (i < raw.length && raw[i] !== '\n') i++;
    } else if (raw.startsWith('/*', i)) {
      const end = raw.indexOf('*/', i + 2);
      i = end < 0 ? raw.length : end + 2;
    } else {
      out += raw[i++];
    }
  }
  return out;
}

// `src` without the commas that close an object or array (JSONC allows them).
function dropTrailingCommas(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '"') {
      const end = stringEnd(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (src[i] === ',' && /^\s*[}\]]/.test(src.slice(i + 1))) {
      i++;
      continue;
    }
    out += src[i++];
  }
  return out;
}

// Reads an OpenCode config, which may be JSONC whatever its extension.
// `comments` says whether rewriting it as JSON would lose any. Throws on a
// file that is not JSON even with comments and trailing commas allowed.
export function readJsonc(raw: string): {
  cfg: Record<string, unknown>;
  comments: boolean;
} {
  const plain = stripComments(raw);
  const cfg = JSON.parse(dropTrailingCommas(plain)) as unknown;
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error('not a JSON object');
  }
  return { cfg: cfg as Record<string, unknown>, comments: plain !== raw };
}

// Set `mcp.servers.dgmo`, keeping every other key, server and `mcp` setting.
export function withOpencodeDgmoServer(
  cfg: Record<string, unknown>
): Record<string, unknown> {
  const mcp = (cfg['mcp'] as Record<string, unknown> | undefined) ?? {};
  const servers = (mcp['servers'] as Record<string, unknown> | undefined) ?? {};
  return {
    ...cfg,
    mcp: { ...mcp, servers: { ...servers, dgmo: OPENCODE_MCP_ENTRY } },
  };
}
