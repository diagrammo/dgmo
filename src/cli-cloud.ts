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
// streams come in through `CloudIo`, which is what the tests replace.

import { basename, extname } from 'node:path';
import { parseDgmoChartType } from './dgmo-router';

const PRODUCTION_API = 'https://api.diagrammo.app';

export interface CloudIo {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readFile: (path: string) => string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface DiagramSummary {
  id: string;
  title: string;
  folderId: string | null;
  chartType: string | null;
  version: string | null;
  updatedAt: number;
}

interface DiagramDetail extends DiagramSummary {
  source: string;
}

interface PutResult {
  action: 'created' | 'updated';
  id: string;
  title: string;
  folder: string;
  version: string | null;
}

interface ListItem {
  id: string;
  title: string;
  folder: string;
  chartType: string | null;
  version: string | null;
  updatedAt: number;
}

interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
}

interface SpaceContents {
  items: DiagramSummary[];
  folders: FolderSummary[];
}

class CloudError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** A mistake in the command line itself — the only failure that prints usage. */
class UsageError extends CloudError {}

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

/** What the server's refusal means to the person running the command. */
function describeStatus(status: number, detail: string): string {
  const why = detail ? `: ${detail.replace(/\.+$/, '')}` : '';
  switch (status) {
    case 401:
      return `The API key was refused (401)${why}. Check DGMO_API_KEY — it may be mistyped or revoked.`;
    case 403:
      return `The API key may not do this (403)${why}.`;
    case 404:
      return `Not found (404)${why}. Check --space, --folder, --title or --id.`;
    case 409:
      return `Another write to this diagram landed first (409)${why}. Run the command again.`;
    default:
      return `The Cloud API answered ${status}${why}.`;
  }
}

async function call<T>(
  io: CloudIo,
  key: string,
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  let res: Response;
  try {
    res = await io.fetch(`${PRODUCTION_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw new CloudError(
      `Could not reach ${PRODUCTION_API}: ${(err as Error).message}`
    );
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const problem = (data ?? {}) as { detail?: unknown; title?: unknown };
    const detail =
      typeof problem.detail === 'string'
        ? problem.detail
        : typeof problem.title === 'string'
          ? problem.title
          : '';
    throw new CloudError(describeStatus(res.status, detail), res.status);
  }
  return { status: res.status, data: data as T };
}

function spacePath(spaceId: string, rest: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}${rest}`;
}

/**
 * The server keys a folder's children by name and title under SQLite's
 * `COLLATE NOCASE` (`uq_folders_sibling_name`, `uq_diagrams_sibling_title`),
 * which folds ASCII letters only — so this does too, or `put` and `get` would
 * disagree about which diagram one folder + title names.
 */
const sameName = (a: string, b: string): boolean =>
  a.replace(/[A-Z]/g, (c) => c.toLowerCase()) ===
  b.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The space root is `null`, but older rows store it as `''`. */
const rootIsNull = (id: string | null): string | null =>
  id === '' ? null : id;

/** A folder's path from the space root, `a/b`; `''` for the root itself. */
function folderPath(folders: FolderSummary[], folderId: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  const start = rootIsNull(folderId);
  let cur = start === null ? undefined : byId.get(start);
  while (cur && names.length <= folders.length) {
    names.unshift(cur.name);
    const up = rootIsNull(cur.parentId);
    cur = up === null ? undefined : byId.get(up);
  }
  return names.join('/');
}

/**
 * The folder at `path` (`a/b`, from the space root), or null for the root.
 * Sibling names are unique case-insensitively on the server, so a
 * case-insensitive match is never ambiguous.
 */
function resolveFolder(
  folders: FolderSummary[],
  path: string | undefined
): string | null {
  const parts = (path ?? '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  let parentId: string | null = null;
  for (const name of parts) {
    const hit = folders.find(
      (f) => rootIsNull(f.parentId) === parentId && sameName(f.name, name)
    );
    if (!hit)
      throw new CloudError(
        `No folder "${parts.join('/')}" in this space (stopped at "${name}").`,
        404
      );
    parentId = hit.id;
  }
  return parentId;
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (!v) throw new UsageError(`${name} is required`);
  return v;
}

async function runPut(
  io: CloudIo,
  key: string,
  flags: Map<string, string>,
  positionals: string[]
): Promise<PutResult> {
  const file = positionals[0];
  if (!file) throw new UsageError('dgmo put needs a .dgmo file');
  const spaceId = requireFlag(flags, '--space');
  let source: string;
  try {
    source = io.readFile(file);
  } catch {
    throw new CloudError(`Cannot read file "${file}"`);
  }
  const title = flags.get('--title') ?? basename(file, extname(file));
  const { data: contents } = await call<SpaceContents>(
    io,
    key,
    'GET',
    spacePath(spaceId, '/contents')
  );
  const folderId = resolveFolder(contents.folders, flags.get('--folder'));
  const { status, data } = await call<DiagramDetail>(
    io,
    key,
    'PUT',
    spacePath(spaceId, '/diagrams'),
    { title, source, chartType: parseDgmoChartType(source), folderId }
  );
  return {
    action: status === 201 ? 'created' : 'updated',
    id: data.id,
    title: data.title,
    folder: folderPath(contents.folders, data.folderId),
    version: data.version,
  };
}

async function runGet(
  io: CloudIo,
  key: string,
  flags: Map<string, string>
): Promise<DiagramDetail & { folder: string }> {
  const spaceId = requireFlag(flags, '--space');
  const { data: contents } = await call<SpaceContents>(
    io,
    key,
    'GET',
    spacePath(spaceId, '/contents')
  );
  let id = flags.get('--id');
  if (!id) {
    const title = requireFlag(flags, '--title');
    const folderId = resolveFolder(contents.folders, flags.get('--folder'));
    const hit = contents.items.find(
      (d) => rootIsNull(d.folderId) === folderId && sameName(d.title, title)
    );
    if (!hit)
      throw new CloudError(
        `No diagram titled "${title}" in ${folderId === null ? 'the space root' : `folder "${flags.get('--folder')}"`}.`,
        404
      );
    id = hit.id;
  }
  const { data } = await call<DiagramDetail>(
    io,
    key,
    'GET',
    spacePath(spaceId, `/diagrams/${encodeURIComponent(id)}`)
  );
  return { ...data, folder: folderPath(contents.folders, data.folderId) };
}

async function runLs(
  io: CloudIo,
  key: string,
  flags: Map<string, string>
): Promise<ListItem[]> {
  const spaceId = requireFlag(flags, '--space');
  const { data } = await call<SpaceContents>(
    io,
    key,
    'GET',
    spacePath(spaceId, '/contents')
  );
  return data.items
    .map((d) => ({
      id: d.id,
      title: d.title,
      folder: folderPath(data.folders, d.folderId),
      chartType: d.chartType,
      version: d.version,
      updatedAt: d.updatedAt,
    }))
    .sort((a, b) =>
      `${a.folder}/${a.title}`.localeCompare(`${b.folder}/${b.title}`)
    );
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
      throw new CloudError(
        'DGMO_API_KEY is not set. Mint a space API key on the account page and export it.'
      );
    if (verb === 'put') {
      const r = await runPut(io, key, parsed.flags, parsed.positionals);
      io.stdout(
        json
          ? JSON.stringify({ success: true, ...r }, null, 2) + '\n'
          : `${r.action} ${joinPath(r.folder, r.title)} (${r.id})\n`
      );
    } else if (verb === 'get') {
      const d = await runGet(io, key, parsed.flags);
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
      const items = await runLs(io, key, parsed.flags);
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
      err instanceof CloudError ? err : new CloudError(String(err), undefined);
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
