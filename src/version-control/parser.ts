// ============================================================
// Version-Control — Parser (spec §29)
// ============================================================
//
// Keyword-less grammar: a bare top-level line is a branch, a bare indented line
// is a commit. Re-naming a branch resumes it (replaces `checkout`). Only `merge`
// and `cherry-pick` are required verbs; beyond-Mermaid verbs `ref` / `rebase` /
// `reset` (top-level) and `revert` / `note` (indented) add HEAD + remote-tracking,
// the rebase/reset/revert/squash operations, and step annotations. The parser
// also does the topological placement (seq) and the rebase/reset/squash/revert
// transforms — the renderer only does pixel layout + SVG. Mirrors
// docs/version-control-syntax-mockups.html parse().

import type { PaletteColors } from '../palettes';
import { emit, formatDgmoError, makeFail, suggest } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import { VERSION_CONTROL_DX } from './diagnostics';
import type { Writable } from '../utils/brand';
import { measureIndent, parseFirstLine, extractColor } from '../utils/parsing';
import type {
  ParsedVersionControl,
  VCBranch,
  VCDirection,
  VCNode,
  VCNote,
  VCOptions,
  VCRef,
} from './types';

interface WorkBranch {
  name: string;
  creationLane: number;
  colorToken: string | null;
  order: number | null;
  tip: number | null;
  pendingParent: number | null;
  ab: { ahead: number; behind: number } | null;
}

type Mut = Writable<VCNode>;

export function parseVersionControl(
  content: string,
  palette?: PaletteColors
): ParsedVersionControl {
  const options: Writable<VCOptions> = {
    direction: 'LR',
    noLabels: false,
    noLanes: false,
    noHead: false,
  };
  const result: Writable<ParsedVersionControl> = {
    type: 'version-control',
    title: null,
    titleLineNumber: null,
    nodes: [],
    branches: [],
    refs: [],
    notes: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = makeFail(result);

  if (!content?.trim()) return fail(0, 'No content provided');

  const nodes = result.nodes as Mut[];
  const branches = new Map<string, WorkBranch>();
  const order: string[] = [];
  const refs = result.refs as Writable<VCRef>[];
  const notes = result.notes as Writable<VCNote>[];
  let active: string | null = null;
  let seq = 0;
  let laneCounter = 0;
  let headerParsed = false;

  const makeBranch = (
    name: string,
    parentName: string | null,
    colorToken: string | null,
    ord: number | null
  ): WorkBranch => {
    const existing = branches.get(name);
    if (existing) return existing;
    const b: WorkBranch = {
      name,
      creationLane: laneCounter++,
      colorToken,
      order: ord,
      tip: null,
      pendingParent: null,
      ab: null,
    };
    if (parentName != null) {
      const par = branches.get(parentName);
      b.pendingParent = par ? par.tip : null;
    }
    branches.set(name, b);
    order.push(name);
    return b;
  };

  const matchesRef = (ref: string): Mut[] =>
    nodes.filter((n) => n.message === ref || n.id === ref);
  const findByRef = (ref: string, lineNumber: number): Mut | null => {
    const m = matchesRef(ref);
    if (m.length === 0) return null;
    if (m.length > 1 && !/^[0-9a-f]{4,}$/.test(ref)) {
      result.diagnostics.push(
        emit(VERSION_CONTROL_DX.AMBIGUOUS_REF, lineNumber, {
          ref,
          count: m.length,
        })
      );
    }
    return m[m.length - 1]!;
  };

  const addNode = (
    fields: Pick<VCNode, 'kind' | 'message' | 'type' | 'tag' | 'lineNumber'> & {
      id: string | null;
    }
  ): Mut => {
    const b = branches.get(active!)!;
    const id = fields.id ?? null;
    const node: Mut = {
      key: nodes.length,
      branch: active!,
      lane: b.creationLane,
      seq: seq++,
      kind: fields.kind,
      message: fields.message,
      type: fields.type,
      id,
      tag: fields.tag,
      lineNumber: fields.lineNumber,
      prev: b.tip,
      parent: null,
      mergeFrom: null,
      cherryFrom: null,
      revertFrom: null,
      squashFrom: null,
      movedTo: null,
      ghost: false,
    };
    if (b.pendingParent != null && node.prev === null) {
      node.parent = b.pendingParent;
      b.pendingParent = null;
    }
    b.tip = node.key;
    nodes.push(node);
    return node;
  };

  const ensureActive = (lineNumber: number): void => {
    if (!active) {
      makeBranch('main', null, null, null);
      active = 'main';
    }
    void lineNumber;
  };

  const doRebase = (fb: string, tb: string, lineNumber: number): void => {
    const fbr = branches.get(fb);
    const tbr = branches.get(tb);
    if (!fbr || !tbr) {
      result.diagnostics.push(
        emit(VERSION_CONTROL_DX.UNKNOWN_BRANCH, lineNumber, {
          op: 'rebase',
          branch: !fbr ? fb : tb,
        })
      );
      return;
    }
    const feats = nodes
      .filter((n) => n.branch === fb)
      .sort((a, b) => a.seq - b.seq);
    let prev: number | null = null;
    const first = tbr.tip;
    for (const o of feats) {
      o.ghost = true;
      const copy: Mut = {
        key: nodes.length,
        branch: fb,
        lane: fbr.creationLane,
        seq: seq++,
        kind: 'commit',
        message: o.message,
        type: o.type,
        id: o.id,
        tag: o.tag,
        lineNumber: o.lineNumber,
        prev,
        parent: prev == null ? first : null,
        mergeFrom: null,
        cherryFrom: null,
        revertFrom: null,
        squashFrom: null,
        movedTo: null,
        ghost: false,
      };
      o.movedTo = copy.key;
      nodes.push(copy);
      prev = copy.key;
    }
    fbr.tip = prev;
    active = fb;
  };

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const indent = measureIndent(line);

    // ── First line: `version-control [Title]` ──
    if (!headerParsed) {
      const firstLine = parseFirstLine(trimmed);
      if (firstLine?.chartType === 'version-control') {
        result.title = firstLine.title ?? null;
        result.titleLineNumber = lineNumber;
        headerParsed = true;
        continue;
      }
      let msg = 'Expected "version-control [Title]" as the first line.';
      const hint = suggest(firstLine?.chartType ?? trimmed, [
        'version-control',
      ]);
      if (hint) msg += ` ${hint}`;
      return fail(lineNumber, msg);
    }

    // ── Directives ──
    // Layout direction — canonical booleans `direction-lr` / `direction-tb`
    // (§1.9, last one wins); key+value `direction LR|TB` accepted legacy.
    const dir = /^direction[-\s]+(LR|TB)$/i.exec(trimmed);
    if (dir) {
      options.direction = dir[1]!.toUpperCase() as VCDirection;
      continue;
    }
    if (trimmed === 'no-labels') {
      options.noLabels = true;
      continue;
    }
    if (trimmed === 'no-lanes') {
      options.noLanes = true;
      continue;
    }
    if (trimmed === 'no-head') {
      options.noHead = true;
      continue;
    }

    if (indent === 0) {
      // ── Top-level operation verbs ──
      let m: RegExpExecArray | null;
      if ((m = /^ref\s+(.+?)\s+at\s+(.+?)(?:\s+(remote))?$/.exec(trimmed))) {
        const nm = m[1]!.trim();
        const tgt = findByRef(m[2]!.trim(), lineNumber);
        refs.push({
          name: nm,
          atKey: tgt ? tgt.key : null,
          remote: !!m[3] || /^(origin|upstream)\//.test(nm),
          head: nm === 'HEAD',
          lineNumber,
        });
        continue;
      }
      if ((m = /^rebase\s+(.+?)\s+onto\s+(.+)$/.exec(trimmed))) {
        doRebase(m[1]!.trim(), m[2]!.trim(), lineNumber);
        continue;
      }
      if ((m = /^reset\s+(.+?)\s+to\s+(.+)$/.exec(trimmed))) {
        const br = branches.get(m[1]!.trim());
        const tgt = findByRef(m[2]!.trim(), lineNumber);
        if (!br) {
          result.diagnostics.push(
            emit(VERSION_CONTROL_DX.UNKNOWN_BRANCH, lineNumber, {
              op: 'reset',
              branch: m[1]!.trim(),
            })
          );
        } else if (tgt) {
          for (const n of nodes) {
            if (n.branch === br.name && n.seq > tgt.seq) n.ghost = true;
          }
          br.tip = tgt.key;
          active = br.name;
        }
        continue;
      }

      // ── Branch declaration / resume ──
      // extractColor strips + validates the trailing token (§1.5 diagnostics) and
      // resolves to hex; we keep the NAME so the renderer resolves per-palette.
      const lastWord = trimmed.split(/\s+/).pop() ?? '';
      const colored = extractColor(
        trimmed,
        palette,
        result.diagnostics as DgmoError[],
        lineNumber
      );
      let rest = colored.label;
      const colorToken = colored.color !== undefined ? lastWord : null;
      let ord: number | null = null;
      const om = /\s+order:\s*(\d+)\s*$/.exec(rest);
      if (om) {
        ord = Number(om[1]);
        rest = rest.replace(/\s+order:\s*\d+\s*$/, '');
      }
      let name = rest.trim();
      let parent: string | null = null;
      const fm = rest.split(/\s+from\s+/);
      if (fm.length === 2) {
        name = fm[0]!.trim();
        parent = fm[1]!.trim();
      }
      const existing = branches.get(name);
      if (existing) {
        active = name;
      } else {
        makeBranch(name, parent != null ? parent : active, colorToken, ord);
        active = name;
      }
      continue;
    }

    // ── Indented: explicit verbs, else a commit ──
    ensureActive(lineNumber);
    let m: RegExpExecArray | null;
    if (/^merge\b/.test(trimmed)) {
      const { msg, tag, id, type } = peelMeta(trimmed.slice(5).trim());
      let src = msg.trim();
      let strat: string | null = null;
      const sm = /^(.*?)\s+(squash|ff|no-ff)$/.exec(src);
      if (sm) {
        src = sm[1]!.trim();
        strat = sm[2]!;
      }
      const sb = branches.get(src);
      if (!sb) {
        result.diagnostics.push(
          emit(VERSION_CONTROL_DX.UNKNOWN_BRANCH, lineNumber, {
            op: 'merge',
            branch: src,
          })
        );
      }
      if (strat === 'squash') {
        if (sb) for (const n of nodes) if (n.branch === src) n.ghost = true;
        const node = addNode({
          kind: 'commit',
          message: `Squash ${src}`,
          type: 'normal',
          tag: tag ?? null,
          id: id ?? null,
          lineNumber,
        });
        node.squashFrom = sb ? sb.tip : null;
      } else {
        const node = addNode({
          kind: 'merge',
          message: src,
          type: (type as VCNode['type']) ?? 'normal',
          tag: tag ?? null,
          id: id ?? null,
          lineNumber,
        });
        node.mergeFrom = sb ? sb.tip : null;
      }
      continue;
    }
    if (/^cherry-pick\b/.test(trimmed)) {
      const ref = trimmed.slice(11).trim();
      const s = findByRef(ref, lineNumber);
      const node = addNode({
        kind: 'cherry',
        message: ref,
        type: 'normal',
        tag: null,
        id: null,
        lineNumber,
      });
      node.cherryFrom = s ? s.key : null;
      continue;
    }
    if (/^revert\b/.test(trimmed)) {
      const ref = trimmed.slice(6).trim();
      const s = findByRef(ref, lineNumber);
      const node = addNode({
        kind: 'commit',
        message: s ? `Revert ${s.message}` : 'Revert',
        type: 'reverse',
        tag: null,
        id: null,
        lineNumber,
      });
      node.revertFrom = s ? s.key : null;
      continue;
    }
    if ((m = /^note\b\s*(.*)$/.exec(trimmed))) {
      const b = branches.get(active!)!;
      notes.push({
        num: notes.length + 1,
        anchorKey: b.tip,
        text: m[1]!.trim(),
        lineNumber,
      });
      continue;
    }
    // bare commit — `commit` keyword optional (empty/dotless only)
    const body = trimmed.replace(/^commit\b\s*/, '');
    const { msg, tag, id, type } = peelMeta(body);
    addNode({
      kind: 'commit',
      message: msg || null,
      type: (type as VCNode['type']) ?? 'normal',
      tag: tag ?? null,
      id: id ?? null,
      lineNumber,
    });
  }

  // ── HEAD auto-sits on the active tip ──
  if (!options.noHead && active) {
    const tip = branches.get(active)!.tip;
    if (tip != null && !refs.some((r) => r.head)) {
      refs.push({
        name: 'HEAD',
        atKey: tip,
        remote: false,
        head: true,
        lineNumber: 0,
      });
    }
  }

  // ── Ahead/behind: local branch X vs an origin/X ref (DAG set difference) ──
  const ancestors = (key: number): Set<number> => {
    const seen = new Set<number>();
    const st = [key];
    while (st.length) {
      const k = st.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      const n = nodes[k];
      if (n) {
        if (n.prev != null) st.push(n.prev);
        if (n.parent != null) st.push(n.parent);
        if (n.mergeFrom != null) st.push(n.mergeFrom);
      }
    }
    return seen;
  };
  for (const bn of order) {
    const b = branches.get(bn)!;
    if (b.tip == null) continue;
    const rr = refs.find(
      (r) =>
        r.remote && (r.name === `origin/${bn}` || r.name.endsWith(`/${bn}`))
    );
    if (rr?.atKey != null) {
      const A = ancestors(b.tip);
      const B = ancestors(rr.atKey);
      let ahead = 0;
      let behind = 0;
      A.forEach((k) => {
        if (!B.has(k)) ahead++;
      });
      B.forEach((k) => {
        if (!A.has(k)) behind++;
      });
      b.ab = { ahead, behind };
    }
  }

  // ── Lane ordering: honor `order:`, else declaration order ──
  const ordered = [...order].sort((a, b) => {
    const ba = branches.get(a)!;
    const bb = branches.get(b)!;
    const ka = ba.order ?? ba.creationLane;
    const kb = bb.order ?? bb.creationLane;
    return ka - kb || ba.creationLane - bb.creationLane;
  });
  const laneOf = new Map<string, number>();
  ordered.forEach((nm, idx) => laneOf.set(nm, idx));
  for (const n of nodes) (n as Mut).lane = laneOf.get(n.branch)!;

  // ── Emit branch list (declaration order preserved for legend/gutter) ──
  result.branches = order.map((nm): VCBranch => {
    const b = branches.get(nm)!;
    return {
      name: nm,
      lane: laneOf.get(nm)!,
      colorToken: b.colorToken,
      order: b.order,
      tip: b.tip,
      ab: b.ab,
    };
  });

  if (nodes.length === 0 && !result.error) {
    const diag = emit(
      VERSION_CONTROL_DX.NO_COMMITS,
      result.titleLineNumber ?? 1
    );
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  return result;
}

/** Peel same-line `id:` / `tag:` / `type:` metadata off a commit/merge body. */
function peelMeta(s: string): {
  msg: string;
  tag: string | null;
  type: string | null;
  id: string | null;
} {
  const out = {
    msg: s,
    tag: null as string | null,
    type: null as string | null,
    id: null as string | null,
  };
  const idx = s.search(/\b(tag|type|id)\s*:/);
  if (idx >= 0) {
    out.msg = s.slice(0, idx).trim();
    const re = /(tag|type|id)\s*:\s*([^,]+)/g;
    let m: RegExpExecArray | null;
    const rest = s.slice(idx);
    while ((m = re.exec(rest)) !== null) {
      const k = m[1] as 'tag' | 'type' | 'id';
      out[k] = m[2]!.trim();
    }
  }
  return out;
}
