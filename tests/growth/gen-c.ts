import type { Generator } from './generators';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const pad = (v: number) => String(v).padStart(2, '0');
const COLORS = ['red', 'orange', 'blue', 'green', 'purple', 'teal'];

// ISO 3166 alpha-2 codes of countries the bundled map data resolves.
const COUNTRIES = (
  'US CA MX BR AR CL PE CO VE GB FR DE ES IT PT NL BE SE NO FI PL UA TR EG ZA NG KE ET MA DZ ' +
  'SA IR IQ IN PK BD CN JP KR VN TH ID MY PH AU NZ RU KZ UZ AF TZ AO CD SD LY CU BO PY UY EC'
).split(' ');

export const GENERATORS_C: Record<string, Generator> = {
  // Dated events with durations, spread over several years, three tagged swimlane-style groups.
  timeline: {
    gen: (n) => {
      const lines = ['timeline Growth timeline', ''];
      for (const i of range(n)) {
        const month = (i % 12) + 1;
        const year = 2024 + Math.floor(i / 12);
        const end =
          (i % 12) + 2 > 12
            ? `${year + 1}-01-${pad(10)}`
            : `${year}-${pad(month + 1)}-${pad(10)}`;
        lines.push(
          `${year}-${pad(month)}-${pad((i % 20) + 1)} -> ${end} Milestone ${i}`
        );
      }
      return lines.join('\n');
    },
  },

  'event-line': {
    gen: (n) => {
      const lines = [
        'event-line Growth incident log',
        '',
        'tag Severity as s',
        '  Sev1 red',
        '  Sev2 orange',
        '  Follow-up blue',
        '',
      ];
      const sev = ['Sev1', 'Sev2', 'Follow-up'];
      for (const i of range(n)) {
        const year = 2024 + Math.floor(i / 12);
        const d = `${year}-${pad((i % 12) + 1)}-${pad((i % 27) + 1)}`;
        lines.push(
          `${d} Event ${i} happened in the payments platform  s: ${sev[i % 3]}`
        );
        lines.push(
          `  Description of event ${i} with **detail** on what changed.`
        );
      }
      return lines.join('\n');
    },
  },

  quadrant: {
    gen: (n) => {
      const lines = [
        'quadrant Growth roadmap',
        '',
        'x-axis Low Effort, High Effort',
        'y-axis Low Impact, High Impact',
        '',
        'top-left Quick Wins',
        'top-right Major Projects',
        'bottom-left Fill-ins',
        'bottom-right Avoid',
        '',
      ];
      for (const i of range(n)) {
        const x = ((i * 37) % 97) / 100 + 0.01;
        const y = ((i * 53) % 89) / 100 + 0.05;
        lines.push(
          `Item ${i} ${COLORS[i % 4]} ${x.toFixed(2)} ${y.toFixed(2)}`
        );
      }
      return lines.join('\n');
    },
  },

  'tech-radar': {
    gen: (n) => {
      const lines = [
        'tech-radar Growth radar',
        '',
        'rings',
        '  Adopt',
        '  Trial',
        '  Assess',
        '  Hold',
        '',
      ];
      const quads = [
        ['Techniques', 'top-right'],
        ['Tools', 'top-left'],
        ['Platforms', 'bottom-right'],
        ['Languages', 'bottom-left'],
      ];
      const rings = ['Adopt', 'Trial', 'Assess', 'Hold'];
      const trends = ['new', 'up', 'down', 'stable'];
      quads.forEach(([name, pos], q) => {
        lines.push(`${name} quadrant: ${pos}`);
        for (const i of range(n)) {
          if (i % 4 !== q) continue;
          lines.push(
            `  ${name} item ${i} ring: ${rings[(i >> 2) % 4]}, trend: ${trends[(i >> 1) % 4]}`
          );
          lines.push(
            `    Notes on **${name} item ${i}** and why it sits here.`
          );
        }
      });
      return lines.join('\n');
    },
  },

  cycle: {
    gen: (n) => {
      const lines = ['cycle Growth loop', ''];
      for (const i of range(n)) {
        lines.push(`Step ${i} ${COLORS[i % COLORS.length]}`);
        lines.push(`  What happens in step ${i} of the loop`);
      }
      return lines.join('\n');
    },
  },

  treemap: {
    gen: (n) => {
      const groups = Math.max(2, Math.round(Math.sqrt(n / 2)));
      const lines = ['treemap Growth storage (GB)'];
      for (const g of range(groups)) {
        lines.push(`Bucket ${g}`);
        for (const i of range(n)) {
          if (i % groups === g)
            lines.push(`  Object ${i} ${100 + ((i * 7919) % 5000)}`);
        }
      }
      return lines.join('\n');
    },
  },

  block: {
    gen: (n) => {
      const cols = 4;
      const lines = [
        'block Growth architecture',
        '',
        'tag Layer as l',
        '  Edge blue',
        '  Service green',
        '  Data orange',
        '',
      ];
      const tags = ['Edge', 'Service', 'Data'];
      const groups = Math.ceil(n / 8);
      for (const g of range(groups)) {
        lines.push(`[Group ${g}] l: ${tags[g % 3]}`);
        const ids = range(n).filter((i) => Math.floor(i / 8) === g);
        for (let r = 0; r < ids.length; r += cols) {
          lines.push(
            '  ' +
              ids
                .slice(r, r + cols)
                .map((i) => `[Block ${i}]`)
                .join(' ')
          );
        }
      }
      return lines.join('\n');
    },
  },

  clock: {
    gen: (n) => {
      const lines = [
        'clock Growth offices',
        'hours 9-17',
        'workweek mon-fri',
        '',
      ];
      for (const i of range(n)) {
        const off = (i % 25) - 12;
        lines.push(
          `UTC${off >= 0 ? '+' : '-'}${Math.abs(off)} as Office ${i} ${COLORS[i % COLORS.length]}`
        );
      }
      return lines.join('\n');
    },
  },

  bracket: {
    gen: (n) => {
      const lines = ['bracket Growth cup', ''];
      for (const i of range(n)) lines.push(`seed ${i + 1} Team ${i + 1}`);
      return lines.join('\n');
    },
  },

  map: {
    gen: (n) => {
      const lines = [
        'map Growth footprint',
        'region-heat Sales ($M)',
        '',
        'tag Market as m',
        '  HQ blue',
        '  Region teal',
        '  Prospect orange',
        '',
      ];
      const tags = ['HQ', 'Region', 'Prospect'];
      for (const i of range(n)) {
        lines.push(
          `${COUNTRIES[i % COUNTRIES.length]} heat: ${10 + ((i * 17) % 90)}, m: ${tags[i % 3]}`
        );
      }
      return lines.join('\n');
    },
  },
};

export const NOT_SCALABLE_C: Record<string, string> = {
  venn: 'parser caps a venn at 2-3 sets ("Venn diagrams support 2–3 sets"); intersections are combinations of those',
  pyramid:
    'parser caps a pyramid at 15 layers, below the 20-element small size',
  ring: 'parser caps a ring at 15 layers, below the 20-element small size',
  body: 'fixed catalog of anatomical muscle groups per figure; no element count to grow',
  goal: 'one now/target pair; nothing to grow',
  countdown: 'one target instant per diagram; nothing to grow',
  'live-link': 'a single pointer to a published diagram; nothing to grow',
};
