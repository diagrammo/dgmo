import { describe, it, expect } from 'vitest';
import { runCloudCommand, type CloudIo } from '../src/cli-cloud';

// `dgmo put` / `get` / `ls` against a mocked HTTP layer (#1093). Each test
// scripts the Cloud API's answers by `METHOD path` and records every request,
// so what the command SENT is asserted as well as what it printed.

const API = 'https://api.diagrammo.app';
const KEY = 'dgmo_sk_lookup_secret';
const SOURCE = 'flowchart\n\nStart -> End\n';

const folders = [
  { id: 'f-docs', name: 'Docs', parentId: null },
  { id: 'f-arch', name: 'Arch', parentId: 'f-docs' },
];
const summary = {
  id: 'd-1',
  title: 'System',
  visibility: 'private',
  version: 'v-3',
  updatedBy: 'u-1',
  updatedAt: 1760000000000,
  chartType: 'flowchart',
  folderId: 'f-arch',
  contentHash: 'h',
};
const contents = { items: [summary], folders, role: 'editor' };
const detail = { ...summary, contentHash: undefined, source: SOURCE };

type Answer = { status: number; body?: unknown };

function harness(
  routes: Record<string, Answer | (() => Answer)>,
  opts: {
    env?: Record<string, string | undefined>;
    files?: Record<string, string>;
  } = {}
) {
  const requests: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const io: CloudIo = {
    env: opts.env ?? { DGMO_API_KEY: KEY },
    fetch: (async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      requests.push({
        method,
        url,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const route = routes[`${method} ${url.slice(API.length)}`];
      if (!route) throw new Error(`unexpected ${method} ${url}`);
      const a = typeof route === 'function' ? route() : route;
      return new Response(
        a.body === undefined ? null : JSON.stringify(a.body),
        {
          status: a.status,
          headers: { 'content-type': 'application/json' },
        }
      );
    }) as typeof fetch,
    readFile: (p) => {
      const f = (opts.files ?? { 'system.dgmo': SOURCE })[p];
      if (f === undefined) throw new Error('ENOENT');
      return f;
    },
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
  return { io, requests, out: () => out.join(''), err: () => err.join('') };
}

const CONTENTS = {
  'GET /spaces/s-1/contents': { status: 200, body: contents },
};

describe('dgmo put', () => {
  it('creates a diagram (201) in a nested folder, keyed by folder + title', async () => {
    const h = harness({
      ...CONTENTS,
      'PUT /spaces/s-1/diagrams': {
        status: 201,
        body: { ...detail, id: 'd-new', title: 'system', version: 'v-1' },
      },
    });
    const code = await runCloudCommand(
      'put',
      ['system.dgmo', '--space', 's-1', '--folder', 'docs/arch', '--json'],
      h.io
    );
    expect(code).toBe(0);
    const put = h.requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe(`${API}/spaces/s-1/diagrams`);
    expect(put.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(put.body).toEqual({
      title: 'system',
      source: SOURCE,
      chartType: 'flowchart',
      folderId: 'f-arch',
    });
    expect(JSON.parse(h.out())).toEqual({
      success: true,
      action: 'created',
      id: 'd-new',
      title: 'system',
      folder: 'Docs/Arch',
      version: 'v-1',
    });
  });

  it('updates the existing diagram (200) at the space root with --title', async () => {
    const h = harness({
      ...CONTENTS,
      'PUT /spaces/s-1/diagrams': {
        status: 200,
        body: { ...detail, folderId: null },
      },
    });
    const code = await runCloudCommand(
      'put',
      ['system.dgmo', '--space', 's-1', '--title', 'System'],
      h.io
    );
    expect(code).toBe(0);
    const put = h.requests.find((r) => r.method === 'PUT')!;
    expect(put.body).toMatchObject({ title: 'System', folderId: null });
    expect(h.out()).toBe('updated System (d-1)\n');
  });

  it('refuses a folder the space does not have, before writing anything', async () => {
    const h = harness({ ...CONTENTS });
    const code = await runCloudCommand(
      'put',
      ['system.dgmo', '--space', 's-1', '--folder', 'Docs/Nope', '--json'],
      h.io
    );
    expect(code).toBe(1);
    expect(h.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(JSON.parse(h.out())).toMatchObject({ success: false, status: 404 });
  });

  it('exits non-zero on a 409 and says to run it again', async () => {
    const h = harness({
      ...CONTENTS,
      'PUT /spaces/s-1/diagrams': {
        status: 409,
        body: {
          title: 'Conflict',
          detail: 'Another write to this diagram landed first — retry.',
        },
      },
    });
    const code = await runCloudCommand(
      'put',
      ['system.dgmo', '--space', 's-1', '--json'],
      h.io
    );
    expect(code).toBe(1);
    const res = JSON.parse(h.out());
    expect(res).toMatchObject({ success: false, status: 409 });
    expect(res.error).toContain('Run the command again');
    expect(res.error).not.toContain('..');
  });
});

describe('dgmo get', () => {
  it('prints the source of the diagram found by folder + title', async () => {
    const h = harness({
      ...CONTENTS,
      'GET /spaces/s-1/diagrams/d-1': { status: 200, body: detail },
    });
    const code = await runCloudCommand(
      'get',
      ['--space', 's-1', '--folder', 'Docs/Arch', '--title', 'System'],
      h.io
    );
    expect(code).toBe(0);
    expect(h.out()).toBe(SOURCE);
  });

  it('reads by --id, and --json carries the source and its place', async () => {
    const h = harness({
      ...CONTENTS,
      'GET /spaces/s-1/diagrams/d-1': { status: 200, body: detail },
    });
    const code = await runCloudCommand(
      'get',
      ['--space', 's-1', '--id', 'd-1', '--json'],
      h.io
    );
    expect(code).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      success: true,
      id: 'd-1',
      title: 'System',
      folder: 'Docs/Arch',
      chartType: 'flowchart',
      version: 'v-3',
      updatedAt: 1760000000000,
      source: SOURCE,
    });
  });

  it('exits non-zero on a 404 for the diagram', async () => {
    const h = harness({
      ...CONTENTS,
      'GET /spaces/s-1/diagrams/gone': {
        status: 404,
        body: { title: 'Not Found' },
      },
    });
    const code = await runCloudCommand(
      'get',
      ['--space', 's-1', '--id', 'gone'],
      h.io
    );
    expect(code).toBe(1);
    expect(h.out()).toBe('');
    expect(h.err()).toContain('Not found (404)');
  });

  it('exits non-zero when no diagram has that title in that folder', async () => {
    const h = harness({ ...CONTENTS });
    const code = await runCloudCommand(
      'get',
      ['--space', 's-1', '--title', 'System', '--json'],
      h.io
    );
    expect(code).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({ success: false, status: 404 });
  });
});

describe('dgmo ls', () => {
  it('lists every diagram with its folder path', async () => {
    const h = harness({ ...CONTENTS });
    const code = await runCloudCommand(
      'ls',
      ['--space', 's-1', '--json'],
      h.io
    );
    expect(code).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      success: true,
      diagrams: [
        {
          id: 'd-1',
          title: 'System',
          folder: 'Docs/Arch',
          chartType: 'flowchart',
          version: 'v-3',
          updatedAt: 1760000000000,
        },
      ],
    });
  });
});

describe('failures and the key', () => {
  it('exits non-zero on a 401 and names DGMO_API_KEY', async () => {
    const h = harness({
      'GET /spaces/s-1/contents': {
        status: 401,
        body: { title: 'Unauthorized' },
      },
    });
    const code = await runCloudCommand(
      'ls',
      ['--space', 's-1', '--json'],
      h.io
    );
    expect(code).toBe(1);
    const res = JSON.parse(h.out());
    expect(res).toMatchObject({ success: false, status: 401 });
    expect(res.error).toContain('DGMO_API_KEY');
  });

  it('refuses to run with no DGMO_API_KEY and sends nothing', async () => {
    const h = harness({}, { env: {} });
    const code = await runCloudCommand('ls', ['--space', 's-1'], h.io);
    expect(code).toBe(1);
    expect(h.requests).toEqual([]);
    expect(h.err()).toContain('DGMO_API_KEY is not set');
  });

  it('a missing --space is a usage error, sent nowhere', async () => {
    const h = harness({}, { env: {} });
    const code = await runCloudCommand('get', ['--title', 'System'], h.io);
    expect(code).toBe(1);
    expect(h.requests).toEqual([]);
    expect(h.err()).toContain('Usage: dgmo put');
  });

  it('writes nothing interactive: no escape codes, no prompt, the same output either way', async () => {
    const h = harness({
      ...CONTENTS,
      'PUT /spaces/s-1/diagrams': { status: 200, body: detail },
    });
    await runCloudCommand('put', ['system.dgmo', '--space', 's-1'], h.io);
    // The io carries no stdin and no TTY flag at all, so there is nothing a
    // prompt or a spinner could use; the output is one plain line.
    expect(h.out()).toBe('updated Docs/Arch/System (d-1)\n');
    expect(h.out() + h.err()).not.toContain(String.fromCharCode(27));
    expect(h.out() + h.err()).not.toContain('\r');
  });
});
