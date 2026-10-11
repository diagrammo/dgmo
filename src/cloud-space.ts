// Write and read a diagram in a Diagrammo Cloud space with a space API key —
// the one HTTP client behind `dgmo put` / `get` / `ls` (#1093) and the
// dgmo-mcp space tools (#1094), so the two surfaces cannot drift apart.
//
// A key is scoped to ONE space, but the token does not say which
// (`dgmo_sk_<lookup>_<secret>`), so every call names the space too. Nothing
// here reads the environment or the filesystem: the caller passes the key and
// the source, and `fetch` is injectable for tests.

import { parseDgmoChartType } from './chart-type-detect';

export const CLOUD_API = 'https://api.diagrammo.app';

export interface CloudSpaceTarget {
  /** A space API key (`dgmo_sk_…`). */
  apiKey: string;
  spaceId: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** A diagram in a space; `folder` is its path from the space root, `''` at the root. */
export interface SpaceDiagramSummary {
  id: string;
  title: string;
  folder: string;
  chartType: string | null;
  version: string | null;
  updatedAt: number;
}

export interface SpaceDiagram extends SpaceDiagramSummary {
  source: string;
}

export interface SpacePutResult {
  action: 'created' | 'updated';
  id: string;
  title: string;
  folder: string;
  version: string | null;
}

/** Any failure; `status` is the Cloud's HTTP status when there was one. */
export class CloudSpaceError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CloudSpaceError';
  }
}

interface WireDiagram {
  id: string;
  title: string;
  folderId: string | null;
  chartType: string | null;
  version: string | null;
  updatedAt: number;
}

interface WireFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface WireContents {
  items: WireDiagram[];
  folders: WireFolder[];
}

/** What the server's refusal means to whoever asked. */
function describeStatus(status: number, detail: string): string {
  const why = detail ? `: ${detail.replace(/\.+$/, '')}` : '';
  switch (status) {
    case 401:
      return `The API key was refused (401)${why}. Check DGMO_API_KEY — it may be mistyped or revoked.`;
    case 403:
      return `The API key may not do this (403)${why}.`;
    case 404:
      return `Not found (404)${why}. Check the space, folder, title or id.`;
    case 409:
      return `Another write to this diagram landed first (409)${why}. Try again.`;
    default:
      return `The Cloud API answered ${status}${why}.`;
  }
}

async function call<T>(
  target: CloudSpaceTarget,
  method: 'GET' | 'PUT',
  rest: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const doFetch = target.fetch ?? fetch;
  const url = `${CLOUD_API}/spaces/${encodeURIComponent(target.spaceId)}${rest}`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    throw new CloudSpaceError(
      `Could not reach ${CLOUD_API}: ${(err as Error).message}`
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
    throw new CloudSpaceError(describeStatus(res.status, detail), res.status);
  }
  return { status: res.status, data: data as T };
}

/**
 * The server keys a folder's children by name and title under SQLite's
 * `COLLATE NOCASE` (`uq_folders_sibling_name`, `uq_diagrams_sibling_title`),
 * which folds ASCII letters only — so this does too, or a put and a get would
 * disagree about which diagram one folder + title names.
 */
const sameName = (a: string, b: string): boolean =>
  a.replace(/[A-Z]/g, (c) => c.toLowerCase()) ===
  b.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The space root is `null`, but older rows store it as `''`. */
const rootIsNull = (id: string | null): string | null =>
  id === '' ? null : id;

/** A folder's path from the space root, `a/b`; `''` for the root itself. */
function folderPath(folders: WireFolder[], folderId: string | null): string {
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
  folders: WireFolder[],
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
      throw new CloudSpaceError(
        `No folder "${parts.join('/')}" in this space (stopped at "${name}").`,
        404
      );
    parentId = hit.id;
  }
  return parentId;
}

const contentsOf = (target: CloudSpaceTarget) =>
  call<WireContents>(target, 'GET', '/contents').then((r) => r.data);

/**
 * Write `source` as the diagram titled `title` in `folder` (a path from the
 * space root; omitted = the root): updates that diagram if it exists, else
 * creates it, private. Re-sending the same bytes is a no-op on the server.
 */
export async function putSpaceDiagram(
  target: CloudSpaceTarget,
  diagram: { source: string; title: string; folder?: string }
): Promise<SpacePutResult> {
  const contents = await contentsOf(target);
  const folderId = resolveFolder(contents.folders, diagram.folder);
  const { status, data } = await call<WireDiagram>(target, 'PUT', '/diagrams', {
    title: diagram.title,
    source: diagram.source,
    chartType: parseDgmoChartType(diagram.source),
    folderId,
  });
  return {
    action: status === 201 ? 'created' : 'updated',
    id: data.id,
    title: data.title,
    folder: folderPath(contents.folders, data.folderId),
    version: data.version,
  };
}

/** Read one diagram, by `id` or by `title` in `folder` (omitted = the root). */
export async function getSpaceDiagram(
  target: CloudSpaceTarget,
  which: { id: string } | { title: string; folder?: string }
): Promise<SpaceDiagram> {
  const contents = await contentsOf(target);
  let id: string;
  if ('id' in which) id = which.id;
  else {
    const folderId = resolveFolder(contents.folders, which.folder);
    const hit = contents.items.find(
      (d) =>
        rootIsNull(d.folderId) === folderId && sameName(d.title, which.title)
    );
    if (!hit)
      throw new CloudSpaceError(
        `No diagram titled "${which.title}" in ${folderId === null ? 'the space root' : `folder "${which.folder}"`}.`,
        404
      );
    id = hit.id;
  }
  const { data } = await call<WireDiagram & { source: string }>(
    target,
    'GET',
    `/diagrams/${encodeURIComponent(id)}`
  );
  return {
    id: data.id,
    title: data.title,
    folder: folderPath(contents.folders, data.folderId),
    chartType: data.chartType,
    version: data.version,
    updatedAt: data.updatedAt,
    source: data.source,
  };
}

/** Every diagram in the space, sorted by folder path then title. */
export async function listSpaceDiagrams(
  target: CloudSpaceTarget
): Promise<SpaceDiagramSummary[]> {
  const contents = await contentsOf(target);
  return contents.items
    .map((d) => ({
      id: d.id,
      title: d.title,
      folder: folderPath(contents.folders, d.folderId),
      chartType: d.chartType,
      version: d.version,
      updatedAt: d.updatedAt,
    }))
    .sort((a, b) =>
      `${a.folder}/${a.title}`.localeCompare(`${b.folder}/${b.title}`)
    );
}
