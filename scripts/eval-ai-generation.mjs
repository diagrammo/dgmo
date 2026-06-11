// ============================================================
// eval-ai-generation.mjs — the Phase-1.5 go/no-go eval (Task P1.5 / AC20).
//
// "Validate that the rewrite is warranted before building it." Measures
// whether DGMO generation quality is ACTUALLY a problem, so Phase 2 is sized
// by evidence (full structural rewrite vs. lean tighten+anti-patterns), not
// assumption. Three deterministic signals + one optional live probe:
//
//   A. suggest_chart_type accuracy — does the "ALWAYS CALL FIRST" lever that
//      Phase 2's retrieval enrichment (AC14) rides on actually pick the right
//      type? Top-1 / top-3 over a diverse prompt set.
//   B. Tier-1 retrieval coverage (F4) — replicates the CURRENT MCP
//      extractSection over language-reference.md for all 45 ids and counts how
//      many resolve. Quantifies the broken hyphenated-id slicer.
//   C. Reference self-consistency — parses every DGMO example fence in the
//      current language-reference.md. A high error/warning rate = the doc
//      actively teaches wrong syntax (full rewrite warranted); near-clean =
//      correct-but-verbose (lean tighten).
//   D. (optional) Live generation probe via `claude -p` — generate DGMO for a
//      few real prompts using ONLY the current AI surface as context, parse
//      the output. Skipped automatically if `claude` is unavailable.
//
// Run: node scripts/eval-ai-generation.mjs   (add --live for probe D)
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { suggestChartTypes, chartTypes } from '@diagrammo/dgmo/advanced';
import { validateDgmoSource } from './lib/fence-validate.mjs';
import { extractTypeBlock } from './lib/ref-anchors.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const ids = new Set(chartTypes.map((c) => c.id));

// ---- A. suggest_chart_type accuracy ----------------------------------------
// { prompt, accept: id[] } — accept lists every defensible top pick.
const SUGGEST_CASES = [
  { prompt: 'show the steps of a user logging in', accept: ['sequence'] },
  { prompt: 'org chart for our company leadership', accept: ['org'] },
  { prompt: 'database schema for users and posts', accept: ['er'] },
  { prompt: 'kanban board for our current sprint', accept: ['kanban'] },
  { prompt: 'gantt chart for the product launch plan', accept: ['gantt'] },
  { prompt: 'flow chart for the checkout process', accept: ['flowchart'] },
  { prompt: 'bar chart of revenue by region', accept: ['bar', 'bar-stacked'] },
  { prompt: 'line chart of signups over time', accept: ['line', 'multi-line'] },
  { prompt: 'pie chart of market share', accept: ['pie', 'doughnut'] },
  { prompt: 'system architecture of our microservices', accept: ['c4', 'boxes-and-lines', 'infra'] },
  { prompt: 'infrastructure diagram with a load balancer and CDN', accept: ['infra'] },
  { prompt: 'class diagram for the domain model', accept: ['class'] },
  { prompt: 'mind map of project ideas', accept: ['mindmap'] },
  { prompt: 'customer journey map for onboarding', accept: ['journey-map'] },
  { prompt: 'RACI matrix for the migration project', accept: ['raci', 'rasci', 'daci'] },
  { prompt: 'state machine for an order lifecycle', accept: ['state'] },
  { prompt: 'tech radar for our frontend tooling', accept: ['tech-radar'] },
  { prompt: 'venn diagram of overlapping team skills', accept: ['venn'] },
  { prompt: 'wireframe of the login screen', accept: ['wireframe'] },
  { prompt: 'sitemap of the marketing website', accept: ['sitemap'] },
  { prompt: 'timeline of company milestones', accept: ['timeline'] },
  { prompt: "pyramid of Maslow's hierarchy of needs", accept: ['pyramid'] },
  { prompt: 'heatmap of activity by hour and day', accept: ['heatmap'] },
  { prompt: 'scatter plot of price versus square footage', accept: ['scatter'] },
  { prompt: 'sankey diagram of energy flow', accept: ['sankey'] },
  { prompt: 'cycle diagram of the water cycle', accept: ['cycle'] },
  { prompt: 'radar chart comparing three products', accept: ['radar'] },
  { prompt: 'funnel of the sales pipeline stages', accept: ['funnel'] },
  { prompt: 'quadrant chart of effort versus impact', accept: ['quadrant'] },
  { prompt: 'boxes and lines architecture of our services', accept: ['boxes-and-lines', 'c4'] },
  { prompt: 'arc diagram of co-authorship links', accept: ['arc'] },
  { prompt: 'word cloud of survey responses', accept: ['wordcloud'] },
  { prompt: 'PERT chart of project task dependencies', accept: ['pert'] },
  { prompt: 'ring chart of budget allocation', accept: ['ring', 'doughnut', 'pie'] },
  { prompt: 'chord diagram of trade between countries', accept: ['chord'] },
];

function evalSuggest() {
  let top1 = 0,
    top3 = 0,
    fellBack = 0;
  const misses = [];
  for (const { prompt, accept } of SUGGEST_CASES) {
    const { ranked, fellBack: fb } = suggestChartTypes(prompt);
    if (fb) fellBack++;
    const rankedIds = ranked.map((r) => r.type.id);
    const t1 = rankedIds[0] && accept.includes(rankedIds[0]);
    const t3 = rankedIds.slice(0, 3).some((id) => accept.includes(id));
    if (t1) top1++;
    if (t3) top3++;
    if (!t1) misses.push({ prompt, got: rankedIds.slice(0, 3), want: accept });
  }
  const n = SUGGEST_CASES.length;
  return { n, top1, top3, fellBack, misses };
}

// ---- B. Tier-1 retrieval coverage (replicates current MCP extractSection) ---
function extractSection(markdown, chartType) {
  const escaped = chartType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(#{2,3})\\s+(?:\\d+\\.\\s+)?${escaped}\\b.*$`, 'im');
  const match = pattern.exec(markdown);
  if (!match) return null;
  const level = match[1];
  const start = match.index;
  const rest = markdown.slice(start + match[0].length);
  const nextHeading = rest.search(new RegExp(`^${level}(?:#|\\s)`, 'm'));
  const end = nextHeading === -1 ? markdown.length : start + match[0].length + nextHeading;
  return markdown.slice(start, end).trim();
}

function evalRetrieval(refMd) {
  // baseline = the pre-rework heading slicer; current = the anchor resolver.
  const baselineFailed = [];
  const currentFailed = [];
  for (const c of chartTypes) {
    if (!extractSection(refMd, c.id)) baselineFailed.push(c.id);
    if (!extractTypeBlock(refMd, c.id)) currentFailed.push(c.id);
  }
  const total = chartTypes.length;
  return {
    total,
    baselineResolved: total - baselineFailed.length,
    baselineFailed,
    currentResolved: total - currentFailed.length,
    currentFailed,
  };
}

// ---- C. Reference self-consistency (parse the doc's own examples) ----------
function extractBareFences(md) {
  const out = [];
  const lines = md.split('\n');
  let inFence = false,
    marker = '',
    buf = [],
    startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!inFence && open) {
      inFence = true;
      marker = open[1][0];
      buf = [];
      startLine = i + 2;
      continue;
    }
    if (inFence) {
      const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === marker) {
        out.push({ source: buf.join('\n'), line: startLine });
        inFence = false;
        continue;
      }
      buf.push(lines[i]);
    }
  }
  return out;
}

function looksLikeDgmo(source) {
  const first = source.split('\n').find((l) => l.trim().length);
  if (!first) return false;
  const tok = first.trim().split(/\s+/)[0];
  return ids.has(tok) || tok === 'rasci' || tok === 'daci';
}

// A fence is a pedagogical TEMPLATE/FRAGMENT (not a real example) when it
// carries placeholder tokens or is a bare declaration skeleton. These parse
// "dirty" by design and must NOT count as the doc teaching wrong syntax.
function isTemplate(source) {
  const body = source.trim();
  const contentLines = body.split('\n').filter((l) => l.trim().length);
  if (contentLines.length <= 2) return true; // declaration skeleton / 1-construct snippet
  return /\[(Title|directives|color|Phase|Column Name|Label)\b|<[a-z][a-z -]*>|\.\.\.|…|\[markers\]/i.test(
    body,
  );
}

// Errors that mean "this fence is an incomplete fragment" rather than "wrong
// syntax" — emptiness / cardinality / placeholder-marker complaints.
const EMPTINESS_ERR = /No .* found|requires at least|Expected exactly|not a recognized .* marker|No nodes|No states|No tables|No classes|No columns|No pages|No phases/i;

function evalSelfConsistency(refMd) {
  const all = extractBareFences(refMd).filter((f) => looksLikeDgmo(f.source));
  const fences = all.filter((f) => !isTemplate(f.source));
  const templates = all.length - fences.length;
  let clean = 0,
    syntaxErr = 0,
    fragmentErr = 0,
    withWarn = 0;
  const failures = [];
  for (const f of fences) {
    const { errors, warnings, chartType } = validateDgmoSource(f.source);
    if (errors.length) {
      const genuine = errors.filter((e) => !EMPTINESS_ERR.test(e.message));
      if (genuine.length) {
        syntaxErr++;
        failures.push({ line: f.line, chartType, first: genuine[0].message });
      } else {
        fragmentErr++;
      }
    } else if (warnings.length) {
      withWarn++;
    } else clean++;
  }
  return { total: fences.length, templates, clean, syntaxErr, fragmentErr, withWarn, failures };
}

// ---- D. Optional live generation probe (claude -p) -------------------------
const PROBE_PROMPTS = [
  'a sequence diagram of an OAuth login: user, web app, auth server, token exchange',
  'an ER diagram for a blog: authors, posts, comments, tags',
  'an infra diagram: CDN in front of a load balancer fanning out to 3 API instances and a database',
  'a flowchart for a CI pipeline: build, test, then deploy or fail',
  'a gantt chart for a 3-sprint project with design, build, QA, launch',
  'a journey map for a SaaS free-trial signup',
];

function haveClaude() {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function evalLive(refMd) {
  // Feed ONLY the current AI surface (the reference) as context — measures
  // what an agent generates from today's doc, unaided by MCP retrieval.
  const context = refMd.slice(0, 24000); // keep the prompt bounded
  const results = [];
  for (const p of PROBE_PROMPTS) {
    const prompt = `You write DGMO diagram markup. Here is the DGMO reference:\n\n${context}\n\n---\nWrite ONLY a DGMO diagram (no prose, no markdown fences) for: ${p}`;
    let out = '';
    try {
      out = execFileSync('claude', ['-p', prompt], {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 1 << 20,
      });
    } catch (e) {
      results.push({ prompt: p, ok: false, note: 'generation failed: ' + (e.message || e) });
      continue;
    }
    const cleaned = out.replace(/```[a-z]*\n?/gi, '').trim();
    const { errors, warnings, chartType } = validateDgmoSource(cleaned);
    results.push({
      prompt: p,
      chartType,
      errors: errors.length,
      warnings: warnings.length,
      ok: errors.length === 0,
      firstError: errors[0]?.message,
    });
  }
  return results;
}

// ---- run -------------------------------------------------------------------
const refMd = readFileSync(join(repo, 'docs/language-reference.md'), 'utf8');
const live = process.argv.includes('--live');

const A = evalSuggest();
const B = evalRetrieval(refMd);
const C = evalSelfConsistency(refMd);

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

console.log('\n=== Phase-1.5 generation eval (go/no-go for Phase 2) ===\n');

console.log(`A. suggest_chart_type accuracy  (n=${A.n})`);
console.log(`   top-1: ${A.top1}/${A.n} (${pct(A.top1, A.n)}%)   top-3: ${A.top3}/${A.n} (${pct(A.top3, A.n)}%)   fellBack: ${A.fellBack}`);
for (const m of A.misses) console.log(`   miss: "${m.prompt}" got=[${m.got.join(', ')}] want=[${m.want.join(', ')}]`);

console.log(`\nB. Tier-1 retrieval coverage  (n=${B.total})`);
console.log(`   baseline (pre-rework heading slicer): ${B.baselineResolved}/${B.total} (${pct(B.baselineResolved, B.total)}%)   failed: ${B.baselineFailed.length}`);
console.log(`   current  (anchor resolver, post-fix): ${B.currentResolved}/${B.total} (${pct(B.currentResolved, B.total)}%)   failed: ${B.currentFailed.length ? B.currentFailed.join(', ') : 'none'}`);

console.log(`\nC. language-reference.md self-consistency  (complete examples=${C.total}, templates excluded=${C.templates})`);
console.log(`   clean: ${C.clean}   GENUINE-syntax-errors: ${C.syntaxErr}   fragment-emptiness(excluded): ${C.fragmentErr}   warnings-only: ${C.withWarn}   syntaxErrorRate: ${pct(C.syntaxErr, C.total)}%`);
for (const f of C.failures.slice(0, 15))
  console.log(`   ERR line ${f.line} (${f.chartType}): ${f.first}`);
if (C.failures.length > 15) console.log(`   …and ${C.failures.length - 15} more`);

let D = null;
if (live) {
  if (!haveClaude()) {
    console.log('\nD. live generation probe — SKIPPED (claude CLI not found)');
  } else {
    console.log('\nD. live generation probe (claude -p, current reference as sole context)…');
    D = evalLive(refMd);
    const ok = D.filter((r) => r.ok).length;
    console.log(`   parse-clean generations: ${ok}/${D.length} (${pct(ok, D.length)}%)`);
    for (const r of D)
      console.log(
        `   ${r.ok ? 'ok ' : 'ERR'} (${r.chartType ?? '?'}) e=${r.errors ?? '-'} w=${r.warnings ?? '-'}  "${r.prompt.slice(0, 48)}…"${r.firstError ? '  → ' + r.firstError : ''}${r.note ? '  ' + r.note : ''}`,
      );
  }
} else {
  console.log('\nD. live generation probe — not run (pass --live to enable)');
}

// ---- verdict ---------------------------------------------------------------
console.log('\n=== verdict ===');
const suggestGood = pct(A.top1, A.n) >= 80 && pct(A.top3, A.n) >= 90;
// The go/no-go was driven by the BASELINE retrieval state; `current` shows the
// post-rework result (anchor resolver) so a re-run documents the fix.
const retrievalBroken = B.baselineFailed.length > 5;
const docTeachesWrong = pct(C.syntaxErr, C.total) >= 10;
if (B.currentFailed.length === 0 && B.baselineFailed.length > 0)
  console.log(`   NOTE: Tier-1 retrieval has since been FIXED (anchor rework) — current resolves all ${B.total}.`);
console.log(`   suggest lever sound (≥80% top1, ≥90% top3): ${suggestGood}`);
console.log(`   Tier-1 retrieval broken (>5 ids fail F4):    ${retrievalBroken}`);
console.log(`   reference teaches wrong syntax (≥10% err):   ${docTeachesWrong}`);
console.log('');
if (docTeachesWrong) {
  console.log('   → GO FULL: the reference itself parses dirty — structural rewrite + curated examples warranted.');
} else if (retrievalBroken) {
  console.log('   → GO STRUCTURAL-LITE: doc is parse-clean but Tier-1 retrieval (F4) is broken — fix anchors/extractSection + add Tier-0 anti-patterns/generator; defer the 45-section curated teardown.');
} else {
  console.log('   → GO LEAN: doc is correct and retrievable — Phase 2 shrinks to tighten + anti-patterns block; full teardown is gold-plating.');
}
console.log('');
