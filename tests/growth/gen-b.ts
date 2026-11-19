import type { Generator } from './generators';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'teal'];

export const GENERATORS_B: Record<string, Generator> = {
  // Region per five widgets; each widget a heading, a labelled field, a button and a list item.
  wireframe: {
    gen: (n) => {
      const lines = ['wireframe Growth screen'];
      const groups = Math.max(1, Math.ceil(n / 5));
      for (const g of range(groups)) {
        lines.push(`[Region ${g}]`, `  # Section ${g}`);
        for (const i of range(Math.min(5, n - g * 5))) {
          const k = g * 5 + i;
          lines.push(
            `  Field ${k}  [Value ${k}]`,
            `  (Action ${k}) primary`,
            `  - Item ${k}`
          );
        }
      }
      return lines.join('\n');
    },
  },
  // n steps spread over phases of four, tagged by channel, with annotations.
  'journey-map': {
    gen: (n) => {
      const lines = [
        'journey-map Growth journey',
        'persona Gina green',
        '  Field engineer, goal is a fast first sync',
        'tag Channel as ch',
        '  Web blue',
        '  Mobile purple',
        '  Email teal',
        'active-tag Channel',
      ];
      for (const i of range(n)) {
        if (i % 4 === 0) lines.push(`[Phase ${i / 4}]`);
        lines.push(
          `  Step ${i} score: ${(i % 5) + 1}, ch: ${['Web', 'Mobile', 'Email'][i % 3]}`,
          `    description: What happens at step ${i}`,
          `    pain: Friction at step ${i}`,
          `    opportunity: Fix for step ${i}`
        );
      }
      return lines.join('\n');
    },
  },
  // n tasks (rows) across six roles, one Accountable each, in phases of five.
  raci: {
    gen: (n) => {
      const roles = ['Cap', 'QM', 'Bos', 'Nav', 'Crew', 'Cook'];
      const lines = ['raci Growth matrix', 'roles'];
      roles.forEach((r, i) => lines.push(`  ${r} ${COLORS[i]}`));
      for (const i of range(n)) {
        if (i % 5 === 0) lines.push(`[Phase ${i / 5}] ${COLORS[(i / 5) % 6]}`);
        lines.push(
          `  Task ${i}`,
          `    ${roles[i % 6]}: A R`,
          `    ${roles[(i + 1) % 6]}: C`,
          `    ${roles[(i + 2) % 6]}: I`
        );
      }
      return lines.join('\n');
    },
  },
  // n bullets spread over the four quadrants.
  swot: {
    gen: (n) => {
      const q = ['strengths', 'weaknesses', 'opportunities', 'threats'];
      const lines = ['swot Growth analysis'];
      q.forEach((name, qi) => {
        lines.push(name);
        for (const i of range(Math.ceil(n / 4))) {
          if (i * 4 + qi < n)
            lines.push(
              `  ${name} point ${i} with a sentence of realistic length`
            );
        }
      });
      return lines.join('\n');
    },
  },
  // n categories, three grouped series.
  bar: {
    gen: (n) => {
      const lines = [
        'bar Growth bars',
        'x-axis Region',
        'y-axis Visitors',
        'group',
      ];
      ['2023 blue', '2024 green', '2025 orange'].forEach((s) =>
        lines.push(`  ${s}`)
      );
      for (const i of range(n))
        lines.push(
          `Region ${i} ${50 + ((i * 7) % 90)} ${60 + ((i * 11) % 80)} ${70 + ((i * 13) % 70)}`
        );
      return lines.join('\n');
    },
  },
  // n x-positions, three series.
  line: {
    gen: (n) => {
      const lines = [
        'line Growth lines',
        'series',
        '  Alpha blue',
        '  Beta green',
        '  Gamma orange',
        'x-axis Time',
        'y-axis Load',
      ];
      for (const i of range(n))
        lines.push(
          `T${i} ${10 + ((i * 7) % 40)} ${20 + ((i * 11) % 30)} ${15 + ((i * 13) % 50)}`
        );
      return lines.join('\n');
    },
  },
  // n groups of 20 values each, as in gallery/fixtures/boxplot.dgmo.
  boxplot: {
    gen: (n) => {
      const lines = ['boxplot Growth spread', 'y-axis Days'];
      for (const g of range(n)) {
        lines.push('', `[Group ${g}]`);
        lines.push(
          range(20)
            .map((i) => 1 + ((g * 3 + i * 7) % 25))
            .join(' ')
        );
      }
      return lines.join('\n');
    },
  },
  // n rows of 10 values. No `bin-width`: the type picks its own bins, as a
  // real file leaves it to.
  histogram: {
    gen: (n) => {
      const lines = [
        'histogram Growth distribution',
        'x-axis Minutes',
        'y-axis Orders',
        '',
      ];
      for (const r of range(n))
        lines.push(
          range(10)
            .map((i) => (10 + ((r * 7 + i * 13) % 40) + i / 10).toFixed(1))
            .join(' ')
        );
      return lines.join('\n');
    },
  },
  // n slices.
  pie: {
    gen: (n) =>
      [
        'pie Growth slices',
        ...range(n).map((i) => `Slice ${i} ${1 + ((i * 7) % 23)}`),
      ].join('\n'),
  },
  // n axes, three series.
  radar: {
    gen: (n) => {
      const lines = [
        'radar Growth radar',
        'series',
        '  Self blue',
        '  Peer green',
        '  Target orange',
      ];
      for (const i of range(n))
        lines.push(
          `Competency ${i} ${1 + (i % 5)} ${1 + ((i * 2) % 5)} ${3 + (i % 3)}`
        );
      return lines.join('\n');
    },
  },
  // n sectors.
  'polar-area': {
    gen: (n) =>
      [
        'polar-area Growth sectors',
        ...range(n).map((i) => `Sector ${i} ${1 + ((i * 7) % 23)}`),
      ].join('\n'),
  },
  // n labelled points in three groups.
  scatter: {
    gen: (n) => {
      const lines = [
        'scatter Growth scatter',
        'x-axis Requests per second',
        'y-axis Latency (ms)',
      ];
      const groups = ['Edge blue', 'Core green', 'Batch orange'];
      groups.forEach((g, gi) => {
        lines.push(`[${g.split(' ')[0]}] ${g.split(' ')[1]}`);
        for (const i of range(Math.ceil(n / 3))) {
          if (i * 3 + gi < n)
            lines.push(
              `  pt-${gi}-${i} ${1000 + ((i * 37) % 400)} ${30 + ((i * 17) % 60)}`
            );
        }
      });
      return lines.join('\n');
    },
  },
  // Layered flows: n flows over layers of ~sqrt(n) nodes, each node feeding two in the next layer.
  sankey: {
    gen: (n) => {
      const w = Math.max(3, Math.ceil(Math.sqrt(n)));
      const layers = Math.max(2, Math.ceil(n / (2 * w)) + 1);
      const lines = ['sankey Growth flows'];
      let flows = 0;
      for (const l of range(layers - 1)) {
        for (const j of range(w)) {
          for (const d of [0, 1]) {
            if (flows >= n) break;
            lines.push(
              `Stage ${l} node ${j}`,
              `  Stage ${l + 1} node ${(j + d) % w} ${10 + ((j * 3 + d) % 17)}`
            );
            flows++;
          }
        }
      }
      // collapse repeated source lines: valid as-is (each source line restarts its group)
      return lines.join('\n');
    },
  },
  // n curves is the size dimension: a handful of curves, each its own expression.
  function: {
    gen: (n) => {
      const lines = [
        'function Growth curves',
        'x-axis X',
        'y-axis Y',
        'x-axis 0..100',
      ];
      for (const i of range(n))
        lines.push(
          `Curve ${i} ${COLORS[i % 6]}: ${i + 1}*sin(x/${(i % 7) + 3}) + ${i}`
        );
      return lines.join('\n');
    },
  },
  // About n cells: square grid, sqrt(n) rows by sqrt(n) columns (both axes grow).
  heatmap: {
    gen: (n) => {
      const side = Math.max(2, Math.ceil(Math.sqrt(n)));
      const lines = ['heatmap Growth heatmap', 'columns'];
      for (const c of range(side)) lines.push(`  Category ${c}`);
      for (const r of range(side))
        lines.push(
          `Team ${r} ${range(side)
            .map((c) => (r * 7 + c * 3) % 13)
            .join(' ')}`
        );
      return lines.join('\n');
    },
  },
  // n stages, descending.
  funnel: {
    gen: (n) =>
      [
        'funnel Growth funnel',
        ...range(n).map(
          (i) =>
            `Stage ${i} ${Math.max(1, 100000 - i * Math.floor(99000 / Math.max(1, n)))}`
        ),
      ].join('\n'),
  },
  // n series across four periods.
  slope: {
    gen: (n) => {
      const lines = [
        'slope Growth slope',
        'period FY2023 FY2024 FY2025 FY2026',
      ];
      for (const i of range(n))
        lines.push(
          `Metric ${i} ${COLORS[i % 6]} ${5 + (i % 11)} ${6 + ((i * 3) % 13)} ${4 + ((i * 5) % 17)} ${7 + ((i * 7) % 19)}`
        );
      return lines.join('\n');
    },
  },
  // n weighted words.
  wordcloud: {
    limit: 2,
    why: 'spiral placement tests each word against every word already placed (collision scan), so cost is near n^1.5; readings 1.45-1.58',
    gen: (n) =>
      [
        'wordcloud Growth words',
        ...range(n).map(
          (i) =>
            `Term${i} ${Math.max(1, 100 - Math.floor((i * 99) / Math.max(1, n)))}`
        ),
      ].join('\n'),
  },
  // n weighted links among ~n/2 nodes, in groups.
  arc: {
    gen: (n) => {
      const nodes = Math.max(4, Math.ceil(n / 2));
      const lines = ['arc Growth links'];
      for (const g of range(4)) {
        lines.push(`[Group ${g}] ${COLORS[g]}`);
        for (const i of range(n)) {
          if (i % 4 === g)
            lines.push(
              `  Node ${i % nodes} -> Node ${(i * 7 + 1) % nodes} ${1 + (i % 9)}`
            );
        }
      }
      lines.push('order group');
      return lines.join('\n');
    },
  },
};

export const NOT_SCALABLE_B: Record<string, string> = {};
