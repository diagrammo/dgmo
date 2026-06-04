// Dev-only cockpit for iterating suggest_chart_type. NOT bundled/shipped.
// Runs the REAL scorer (scoreChartType/confidence/MIN_PRIMARY_SCORE) over an
// editable in-memory clone of the trigger registry, so you can what-if triggers
// and watch the corpus hit-rate move live. The thin "suggest" loop here mirrors
// suggestChartTypes() exactly — only the trigger source is swappable.
import {
  scoreChartType,
  confidence,
  MIN_PRIMARY_SCORE,
  type Confidence,
} from '../../src/chart-type-scoring';
import { chartTypes as BASE } from '../../src/chart-types';
import corpus from '../../tests/fixtures/suggest-corpus.json';

interface Type {
  id: string;
  description: string;
  triggers: string[];
  fallback?: true;
}
interface Entry {
  prompt: string;
  expected: string[];
  note?: string;
}

// Editable clone of the registry (triggers mutable for what-if).
const types: Type[] = BASE.map((t) => ({
  id: t.id,
  description: t.description,
  triggers: [...t.triggers],
  fallback: t.fallback,
}));
const baselineTriggers = new Map(types.map((t) => [t.id, [...t.triggers]]));

function suggest(prompt: string) {
  const scored = types
    .map((t) => ({ t, ...scoreChartType(prompt, t as never) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 0;
  const second = scored[1]?.score ?? 0;
  return {
    scored,
    confidence: confidence(top, second) as Confidence,
    fellBack: top < MIN_PRIMARY_SCORE,
  };
}

type Verdict = 'top1' | 'top3' | 'miss';
function verdict(e: Entry): { v: Verdict; r: ReturnType<typeof suggest> } {
  const r = suggest(e.prompt);
  const ids = r.scored.map((s) => s.t.id);
  if (r.fellBack) return { v: 'miss', r };
  if (ids[0] && e.expected.includes(ids[0])) return { v: 'top1', r };
  if (ids.slice(0, 3).some((id) => e.expected.includes(id)))
    return { v: 'top3', r };
  return { v: 'miss', r };
}

// ---- state ----
const entries = corpus as Entry[];
let filter: 'all' | 'top1' | 'top3' | 'miss' = 'all';
let editId = types[0].id;

const app = document.getElementById('app')!;
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const candLine = (s: { t: Type; score: number; matched: string[] }) =>
  `<div class="cand"><span class="id">${s.t.id}</span><span class="sc">${s.score}</span>` +
  `<span class="mt">${s.matched.length ? '←' + s.matched.map(esc).join(', ') : ''}</span></div>`;

function render() {
  const scored = entries.map((e) => ({ e, ...verdict(e) }));
  const top1 = scored.filter((s) => s.v === 'top1').length;
  const top3 = scored.filter((s) => s.v === 'top1' || s.v === 'top3').length;
  const shown = scored.filter((s) => filter === 'all' || s.v === filter);
  const et = types.find((t) => t.id === editId)!;
  const dirty =
    JSON.stringify(et.triggers) !==
    JSON.stringify(baselineTriggers.get(editId));

  app.innerHTML = `
    <h1>suggest_chart_type — cockpit</h1>
    <p class="sub">Real scorer over an editable trigger registry · ${types.length} types · ${entries.length} corpus prompts</p>
    <div class="hit">
      <span><b class="${top1 ? 'v-top1' : 'v-miss'}">${top1}/${entries.length}</b> top-1 confident-correct</span>
      <span><b>${top3}/${entries.length}</b> expected-in-top-3</span>
      <span class="delta">edit triggers below → these recompute live</span>
    </div>

    <h2>Probe</h2>
    <div class="panel">
      <input id="probe" type="text" placeholder="type a prompt, e.g. map of our store locations" autocomplete="off" />
      <div class="cands" id="probeOut"><span class="muted">type above…</span></div>
    </div>

    <h2>Corpus</h2>
    <div class="filters">
      ${(['all', 'miss', 'top3', 'top1'] as const)
        .map(
          (f) =>
            `<button data-f="${f}" class="${filter === f ? 'active' : ''}">${f}</button>`
        )
        .join('')}
    </div>
    <table>
      <thead><tr><th>prompt</th><th>expected</th><th>verdict</th><th>conf</th><th>top 3 (score ←matched)</th></tr></thead>
      <tbody>
        ${shown
          .map(
            ({ e, v, r }) => `<tr>
          <td>${esc(e.prompt)}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</td>
          <td>${e.expected.map(esc).join(' / ')}</td>
          <td class="v-${v}">${v === 'top1' ? '✅ top-1' : v === 'top3' ? '🟡 top-3' : '❌ miss'}</td>
          <td><span class="pill ${r.confidence}">${r.confidence}${r.fellBack ? ' · fb' : ''}</span></td>
          <td>${r.scored.slice(0, 3).map(candLine).join('') || '<span class="muted">— none —</span>'}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>

    <h2>What-if: edit triggers</h2>
    <div class="row2">
      <div class="panel">
        <div class="editrow">
          <select id="editSel">${types
            .map(
              (t) =>
                `<option value="${t.id}" ${t.id === editId ? 'selected' : ''}>${t.id} (${t.triggers.length})</option>`
            )
            .join('')}</select>
          <button id="resetBtn" ${dirty ? '' : 'disabled'}>reset</button>
          <span class="note">${dirty ? 'modified — corpus reflects your edit' : 'matches source'}</span>
        </div>
        <textarea id="trigEdit" spellcheck="false">${esc(et.triggers.join('\n'))}</textarea>
        <p class="note">one trigger phrase per line · scoring is contiguous-phrase, weighted by word count</p>
      </div>
      <div class="panel">
        <p class="note">description (read-only — also contributes a 0.25× per-word tiebreak)</p>
        <p>${esc(et.description)}</p>
      </div>
    </div>
  `;

  // wire probe
  const probe = document.getElementById('probe') as HTMLInputElement;
  const out = document.getElementById('probeOut')!;
  probe.addEventListener('input', () => {
    const q = probe.value.trim();
    if (!q) {
      out.innerHTML = '<span class="muted">type above…</span>';
      return;
    }
    const r = suggest(q);
    out.innerHTML =
      `<div style="margin-bottom:6px"><span class="pill ${r.confidence}">${r.confidence}${r.fellBack ? ' · fellback' : ''}</span></div>` +
      (r.scored.slice(0, 6).map(candLine).join('') ||
        '<span class="muted">no trigger or description match — would fall back</span>');
  });

  // wire filters
  app.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f as typeof filter;
      render();
    })
  );

  // wire editor
  (document.getElementById('editSel') as HTMLSelectElement).addEventListener(
    'change',
    (e) => {
      editId = (e.target as HTMLSelectElement).value;
      render();
    }
  );
  (document.getElementById('trigEdit') as HTMLTextAreaElement).addEventListener(
    'input',
    (e) => {
      et.triggers = (e.target as HTMLTextAreaElement).value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      // re-render the corpus + hit-rate but keep textarea focus/caret: re-render whole panel is fine here
      rerenderKeepingCaret(e.target as HTMLTextAreaElement);
    }
  );
  document.getElementById('resetBtn')?.addEventListener('click', () => {
    et.triggers = [...baselineTriggers.get(editId)!];
    render();
  });
}

// Re-render hit-rate + corpus live while typing triggers, without yanking the textarea caret.
function rerenderKeepingCaret(ta: HTMLTextAreaElement) {
  const pos = ta.selectionStart;
  const val = ta.value;
  render();
  const ta2 = document.getElementById('trigEdit') as HTMLTextAreaElement;
  if (ta2) {
    ta2.value = val;
    ta2.focus();
    ta2.setSelectionRange(pos, pos);
  }
}

render();
