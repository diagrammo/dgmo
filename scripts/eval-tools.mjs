// ============================================================
// eval-tools.mjs — the MCP-tool / generation SCORECARD.
//
// Runs the curated prompt suite (tests/fixtures/prompt-suite.json) through the
// tool chain an LLM actually uses, against the WORKSPACE dgmo (i.e. what is
// about to ship — the dgmo-mcp package binds to the published dep, so the
// repeatable quality signal lives here, not in the MCP's node_modules tests):
//
//   suggest_chart_type(prompt)  → did it pick a sensible type?
//   get_language_reference(type) → is a per-type slice available?
//   get_examples(type)           → is a curated example available?
//   --live: feed that context to `claude -p`, generate a diagram, then
//           validate (parse) + render (clean?) — "how well do the tools do at
//           actually creating the diagram." Writes an HTML report you can open.
//
// Mechanical mode is deterministic (CI-friendly, gateable on the summary
// thresholds). --live is non-deterministic (run on a schedule / pre-release).
//
//   node scripts/eval-tools.mjs              # mechanical scorecard
//   node scripts/eval-tools.mjs --live       # + claude -p generation + HTML
//   node scripts/eval-tools.mjs --json out.json
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { render } from '@diagrammo/dgmo/advanced';
// The selection suggester moved dgmo→dgmo-mcp; import it from the sibling repo
// so this eval keeps scoring against the live vocabulary (triggers.json).
import { suggestChartTypes } from '../../dgmo-mcp/dist/suggest/scoring.js';
import { validateDgmoSource } from './lib/fence-validate.mjs';
import { extractTypeBlock, extractAiCore } from './lib/ref-anchors.mjs';
import { loadExampleIndex, resolveExample } from './lib/example-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const live = process.argv.includes('--live');
const jsonIdx = process.argv.indexOf('--json');
const jsonOut = jsonIdx !== -1 ? process.argv[jsonIdx + 1] : null;

const suite = JSON.parse(
  readFileSync(join(repo, 'tests/fixtures/prompt-suite.json'), 'utf8')
).cases;
const refMd = readFileSync(join(repo, 'docs/language-reference.md'), 'utf8');
const exampleIndex = loadExampleIndex();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// --- mechanical: run the tool chain per prompt ------------------------------
const rows = suite.map(({ prompt, accept }) => {
  const { ranked } = suggestChartTypes(prompt);
  const top3 = ranked.slice(0, 3).map((r) => r.type.id);
  const chosen = top3[0] ?? null;
  return {
    prompt,
    accept,
    chosen,
    top3,
    top1ok: chosen != null && accept.includes(chosen),
    top3ok: top3.some((id) => accept.includes(id)),
    hasRef: chosen != null && !!extractTypeBlock(refMd, chosen),
    hasExample: chosen != null && !!resolveExample(chosen, exampleIndex),
  };
});

// --- live: generate a diagram for each prompt using the tool context --------
function haveClaude() {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function generate(row) {
  // The context an MCP agent would assemble: the chosen type's reference slice
  // (Tier 1) plus the universal anti-patterns (Tier 0).
  const slice = row.chosen ? extractTypeBlock(refMd, row.chosen) : null;
  const anti = extractAiCore(refMd, 'ANTIPATTERNS') ?? '';
  const context = `${anti}\n\n${slice ?? ''}`.slice(0, 16000);
  const prompt = `You write DGMO diagram markup. Use ONLY this reference:\n\n${context}\n\n---\nWrite ONLY a DGMO ${row.chosen ?? ''} diagram (no prose, no markdown fences) for: ${row.prompt}`;
  let out;
  try {
    out = execFileSync('claude', ['-p', prompt], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 1 << 20,
    });
  } catch (e) {
    return {
      ...row,
      gen: null,
      parsed: false,
      warnings: -1,
      rendered: false,
      note: 'gen failed: ' + (e.message || e),
    };
  }
  const dgmo = out.replace(/```[a-z]*\n?/gi, '').trim();
  const { errors, warnings } = validateDgmoSource(dgmo);
  let svg = null;
  if (errors.length === 0) {
    try {
      const r = await render(dgmo, { theme: 'light', palette: 'slate' });
      svg = r?.svg ?? null;
    } catch {
      svg = null;
    }
  }
  return {
    ...row,
    gen: dgmo,
    parsed: errors.length === 0,
    warnings: warnings.length,
    rendered: !!svg,
    firstError: errors[0]?.message,
    svg,
  };
}

let liveRows = null;
if (live) {
  if (!haveClaude()) {
    console.log(
      '--live requested but `claude` CLI not found — running mechanical only.\n'
    );
  } else {
    liveRows = [];
    for (const row of rows) liveRows.push(await generate(row));
  }
}

// --- report -----------------------------------------------------------------
const R = liveRows ?? rows;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('\n=== DGMO tool scorecard ===\n');
console.log(
  pad('prompt', 46) +
    pad('chose', 14) +
    pad('sel', 5) +
    pad('ref', 4) +
    pad('ex', 4) +
    (liveRows ? pad('gen', 5) + 'warn' : '')
);
console.log('-'.repeat(liveRows ? 86 : 73));
for (const r of R) {
  const sel = r.top1ok ? 'ok' : r.top3ok ? '~3' : 'MISS';
  let line =
    pad(r.prompt, 46) +
    pad(r.chosen ?? '-', 14) +
    pad(sel, 5) +
    pad(r.hasRef ? 'y' : '-', 4) +
    pad(r.hasExample ? 'y' : '-', 4);
  if (liveRows)
    line +=
      pad(r.parsed ? (r.rendered ? 'ok' : 'p-only') : 'FAIL', 5) +
      (r.warnings >= 0 ? r.warnings : '-');
  console.log(line);
}

const n = R.length;
const summary = {
  cases: n,
  selTop1: pct(R.filter((r) => r.top1ok).length, n),
  selTop3: pct(R.filter((r) => r.top3ok).length, n),
  refCoverage: pct(R.filter((r) => r.hasRef).length, n),
  exampleCoverage: pct(R.filter((r) => r.hasExample).length, n),
  ...(liveRows
    ? {
        genParseClean: pct(liveRows.filter((r) => r.parsed).length, n),
        genRenderClean: pct(liveRows.filter((r) => r.rendered).length, n),
        genZeroWarn: pct(
          liveRows.filter((r) => r.parsed && r.warnings === 0).length,
          n
        ),
      }
    : {}),
};
console.log('\n=== summary ===');
console.log(
  `  type selection : top-1 ${summary.selTop1}%   top-3 ${summary.selTop3}%`
);
console.log(
  `  retrieval      : reference ${summary.refCoverage}%   example ${summary.exampleCoverage}%`
);
if (liveRows)
  console.log(
    `  generation     : parse-clean ${summary.genParseClean}%   renders ${summary.genRenderClean}%   zero-warning ${summary.genZeroWarn}%`
  );

// --- artifacts --------------------------------------------------------------
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ summary, rows: R.map(({ svg, ...r }) => r) }, null, 2)
  );
  console.log(`\n  JSON results → ${jsonOut}`);
}
if (liveRows) {
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
    );
  const cards = liveRows
    .map(
      (
        r
      ) => `<section style="border:1px solid #ccc;border-radius:8px;padding:16px;margin:12px 0">
  <div><b>${esc(r.prompt)}</b></div>
  <div style="color:#555;font-size:13px">chose <code>${esc(r.chosen)}</code> · selection ${r.top1ok ? '✅' : r.top3ok ? '🟡' : '❌'} · ${r.parsed ? (r.rendered ? '✅ renders' : '🟡 parses only') : '❌ ' + esc(r.firstError ?? r.note)} · ${r.warnings >= 0 ? r.warnings + ' warnings' : ''}</div>
  <div style="display:flex;gap:16px;margin-top:10px;align-items:flex-start;flex-wrap:wrap">
    <pre style="background:#f5f5f5;padding:10px;border-radius:6px;font-size:12px;max-width:420px;overflow:auto">${esc(r.gen)}</pre>
    <div>${r.svg ?? '<i>no render</i>'}</div>
  </div>
</section>`
    )
    .join('\n');
  const html = `<!doctype html><meta charset="utf8"><title>DGMO tool scorecard</title>
<body style="font-family:system-ui;max-width:1000px;margin:24px auto;padding:0 16px">
<h1>DGMO tool scorecard</h1>
<p>selection top-1 ${summary.selTop1}% · parse-clean ${summary.genParseClean}% · renders ${summary.genRenderClean}% · zero-warning ${summary.genZeroWarn}% · n=${n}</p>
${cards}</body>`;
  const out = join(tmpdir(), 'dgmo-tool-scorecard.html');
  writeFileSync(out, html);
  console.log(`\n  HTML report → ${out}\n  open with: open ${out}`);
}
console.log('');
