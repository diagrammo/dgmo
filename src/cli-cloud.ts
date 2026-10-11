// `dgmo put`, `dgmo get` and `dgmo ls`: write and read a diagram in a Diagrammo
// Cloud space with a space API key, so a CI job or an agent can keep a diagram
// current with no browser and no sign-in (#1093, slice 4 of #894).
//
// The key comes from `DGMO_API_KEY` and nowhere else — never a flag, so it does
// not land in shell history or a CI log. A key is scoped to ONE space, but the
// token does not say which (`dgmo_sk_<lookup>_<secret>`), so `--space` names it.
//
// Everything here is machine-shaped: `--json` on every verb, a non-zero exit on
// any failure, and nothing that prompts or animates — so it behaves the same
// whether or not stdout is a terminal.
//
// It lives apart from cli.ts because that module calls `main()` at import time,
// so nothing inside it can be imported by a test. `fetch` and the process
// streams come in through `CloudIo`, which is what the tests replace. The HTTP
// itself is `cloud-space.ts`, shared with dgmo-mcp's space tools (#1094).

import { basename, extname } from 'node:path';
import {
  CloudSpaceError,
  getSpaceDiagram,
  listSpaceDiagrams,
  putSpaceDiagram,
  type CloudSpaceTarget,
} from './cloud-space';

export interface CloudIo {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readFile: (path: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** A mistake in the command line itself — the only failure that prints usage. */
class UsageError extends CloudSpaceError {}

const USAGE = [
  'Usage: dgmo put <file> --space <space-id> [--folder <path>] [--title <title>] [--json]',
  '       dgmo get --space <space-id> [--folder <path>] --title <title> [--json]',
  '       dgmo get --space <space-id> --id <diagram-id> [--json]',
  '       dgmo ls --space <space-id> [--json]',
  'The space API key is read from DGMO_API_KEY.',
].join('\n');

const VALUE_FLAGS = new Set(['--space', '--folder', '--title', '--id']);

function parseFlags(args: string[]): {
  flags: Map<string, string>;
  positionals: string[];
  json: boolean;
} {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--json') json = true;
    else if (VALUE_FLAGS.has(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--'))
        throw new UsageError(`${a} needs a value`);
      flags.set(a, v);
      i++;
    } else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}`);
    else positionals.push(a);
  }
  return { flags, positionals, json };
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (!v) throw new UsageError(`${name} is required`);
  return v;
}

function readSource(
  io: CloudIo,
  positionals: string[]
): {
  file: string;
  source: string;
} {
  const file = positionals[0];
  if (!file) throw new UsageError('dgmo put needs a .dgmo file');
  try {
    return { file, source: io.readFile(file) };
  } catch {
    throw new CloudSpaceError(`Cannot read file "${file}"`);
  }
}

const joinPath = (folder: string, title: string) =>
  folder ? `${folder}/${title}` : title;

/**
 * Run `put`, `get` or `ls` with `args` (everything after the verb) and return
 * the process exit code: 0 on success, 1 on any failure.
 */
export async function runCloudCommand(
  verb: 'put' | 'get' | 'ls',
  args: string[],
  io: CloudIo
): Promise<number> {
  let json = args.includes('--json');
  try {
    const parsed = parseFlags(args);
    json = parsed.json;
    requireFlag(parsed.flags, '--space');
    const key = io.env['DGMO_API_KEY']?.trim();
    if (!key)
      throw new CloudSpaceError(
        'DGMO_API_KEY is not set. Mint a space API key on the account page and export it.'
      );
    const target: CloudSpaceTarget = {
      apiKey: key,
      spaceId: requireFlag(parsed.flags, '--space'),
      fetch: io.fetch,
    };
    const folder = parsed.flags.get('--folder');
    if (verb === 'put') {
      const { file, source } = readSource(io, parsed.positionals);
      const r = await putSpaceDiagram(target, {
        source,
        title: parsed.flags.get('--title') ?? basename(file, extname(file)),
        ...(folder === undefined ? {} : { folder }),
      });
      io.stdout(
        json
          ? JSON.stringify({ success: true, ...r }, null, 2) + '\n'
          : `${r.action} ${joinPath(r.folder, r.title)} (${r.id})\n`
      );
    } else if (verb === 'get') {
      const id = parsed.flags.get('--id');
      const d = await getSpaceDiagram(
        target,
        id
          ? { id }
          : {
              title: requireFlag(parsed.flags, '--title'),
              ...(folder === undefined ? {} : { folder }),
            }
      );
      io.stdout(
        json
          ? JSON.stringify(
              {
                success: true,
                id: d.id,
                title: d.title,
                folder: d.folder,
                chartType: d.chartType,
                version: d.version,
                updatedAt: d.updatedAt,
                source: d.source,
              },
              null,
              2
            ) + '\n'
          : d.source
      );
    } else {
      const items = await listSpaceDiagrams(target);
      io.stdout(
        json
          ? JSON.stringify({ success: true, diagrams: items }, null, 2) + '\n'
          : items
              .map((d) => `${joinPath(d.folder, d.title)}\t${d.id}\n`)
              .join('')
      );
    }
    return 0;
  } catch (err) {
    const e =
      err instanceof CloudSpaceError
        ? err
        : new CloudSpaceError(String(err), undefined);
    if (json)
      io.stdout(
        JSON.stringify(
          {
            success: false,
            error: e.message,
            ...(e.status === undefined ? {} : { status: e.status }),
          },
          null,
          2
        ) + '\n'
      );
    io.stderr(`Error: ${e.message}\n`);
    if (err instanceof UsageError) io.stderr(USAGE + '\n');
    return 1;
  }
}
