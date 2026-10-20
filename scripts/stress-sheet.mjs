#!/usr/bin/env node
// stress-sheet.mjs — write a dated stress contact sheet into the ecosystem docs (#1417).
//
//   node scripts/stress-sheet.mjs --render <dir> --docs <ecosystem-docs root> [--date YYYY-MM-DD] [--by <model>]
//
// <dir> is a `pnpm stress:render` output: report.json plus one PNG per fixture,
// and verdicts.json written by the vision pass, keyed by fixture id:
//   { "<id>": { verdict, note, decision, issue } }   issue = tracker number or null
// Writes src/content/docs/stress/<date>.md and public/stress/<date>/*.png, then
// prunes sheets beyond SHEETS_KEEP (page and images; git history keeps them).
// Defects first, in rubric order, so the owner reads the calls that need a veto
// before the ones that need nothing.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SHEETS_KEEP = 12;
const ORDER = [
  'broken',
  'squeezed',
  'collided',
  'lopsided',
  'ugly-but-fine',
  'ok',
  'unjudged',
];
const TRACKER = 'https://github.com/diagrammo/diagrammo/issues';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const renderDir = arg('render');
const docsRoot = arg('docs');
const date = arg('date', new Date().toISOString().slice(0, 10));
const by = arg('by', 'claude');
if (!renderDir || !docsRoot) {
  console.error(
    'usage: stress-sheet.mjs --render <dir> --docs <ecosystem-docs root> [--date YYYY-MM-DD] [--by <model>]'
  );
  process.exit(2);
}

const report = JSON.parse(
  readFileSync(join(renderDir, 'report.json'), 'utf-8')
);
const verdictsPath = join(renderDir, 'verdicts.json');
const verdicts = existsSync(verdictsPath)
  ? JSON.parse(readFileSync(verdictsPath, 'utf-8'))
  : {};

const pageDir = join(docsRoot, 'src/content/docs/stress');
const imgDir = join(docsRoot, 'public/stress', date);
mkdirSync(pageDir, { recursive: true });
mkdirSync(imgDir, { recursive: true });

const issueLink = (ref) => {
  const n = String(ref).match(/(\d+)$/)?.[1];
  return n ? `[#${n}](${TRACKER}/${n})` : String(ref);
};
const esc = (s) => String(s ?? '').replace(/</g, '&lt;');

const rows = report.map((r) => ({
  ...r,
  v: verdicts[r.id] ?? { verdict: 'unjudged' },
}));
rows.sort(
  (a, b) =>
    ORDER.indexOf(a.v.verdict) - ORDER.indexOf(b.v.verdict) ||
    a.id.localeCompare(b.id)
);

const counts = ORDER.map((k) => [
  k,
  rows.filter((r) => r.v.verdict === k).length,
]).filter(([, n]) => n);
const defects = rows.filter(
  (r) => ORDER.indexOf(r.v.verdict) < ORDER.indexOf('ugly-but-fine')
);

const out = [];
out.push('---');
out.push(`title: Stress sheet ${date}`);
out.push(
  `description: ${rows.length} stress fixtures rendered and judged — ${counts.map(([k, n]) => `${n} ${k}`).join(', ')}.`
);
out.push('type: report');
out.push('generated:');
out.push(`  by: ${by}`);
out.push(`  at: ${date}`);
out.push(`stale_after: ${date}`);
out.push('---');
out.push('');
out.push(
  `Each picture below is the PNG the agent judged, rendered from \`dgmo/stress/\` on ${date} (nord, light). ` +
    'Defects come first, each with the fix the agent chose. **Veto a call by commenting on its issue**; silence means the fix goes ahead in a nightly build. ' +
    'How the corpus works: `dgmo/stress/README.md`.'
);
out.push('');
if (defects.length === 0) out.push('**No defects this time.**\n');

for (const r of rows) {
  const slug = r.id.replace(/\.dgmo$/, '');
  if (r.png) copyFileSync(join(renderDir, r.png), join(imgDir, r.png));
  out.push(`## ${r.v.verdict === 'ok' ? '✓' : '✗'} ${slug}`);
  out.push('');
  out.push(`**${r.v.verdict}**${r.v.note ? ` — ${esc(r.v.note)}` : ''}`);
  out.push('');
  if (r.v.decision)
    out.push(
      `- **Agent's fix:** ${esc(r.v.decision)}${r.v.issue ? ` (${issueLink(r.v.issue)})` : ''}`
    );
  out.push(`- **Pushes on:** ${esc(r.intent)}`);
  if (r.findings.length)
    out.push(
      `- **Geometry lints:** ${r.findings.map((f) => `\`${f.rule}\` ${esc(f.detail)}`).join('; ')}`
    );
  if (r.errors.length)
    out.push(`- **Errors:** ${r.errors.map(esc).join('; ')}`);
  // The row the fix line already links is not repeated here.
  const others = r.known.filter((k) => !r.v.issue || !String(k).endsWith(`#${r.v.issue}`));
  if (others.length)
    out.push(`- **Also tracked:** ${others.map(issueLink).join(', ')}`);
  out.push('');
  if (r.png) out.push(`![${slug}](/stress/${date}/${r.png})`);
  out.push('');
}

writeFileSync(join(pageDir, `${date}.md`), out.join('\n'));

// Keep the newest SHEETS_KEEP sheets; the index page is not a sheet.
const sheets = readdirSync(pageDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  .sort()
  .reverse();
for (const old of sheets.slice(SHEETS_KEEP)) {
  const d = old.replace(/\.md$/, '');
  rmSync(join(pageDir, old));
  rmSync(join(docsRoot, 'public/stress', d), { recursive: true, force: true });
}
console.log(
  `wrote stress/${date}.md (${rows.length} fixtures, ${defects.length} defects); kept ${Math.min(sheets.length, SHEETS_KEEP)} sheets`
);
