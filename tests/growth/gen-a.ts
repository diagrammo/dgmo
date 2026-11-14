import type { Generator } from './generators';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const groupsOf = (n: number, size: number) => Math.max(1, Math.ceil(n / size));

export const GENERATORS_A: Record<string, Generator> = {
  // n participants in 4 groups, 3 messages each plus an async one; a note per 10.
  sequence: {
    gen: (n) => {
      const lines = [
        'sequence Growth',
        'tag Zone as z',
        '  inner blue',
        '  outer orange',
      ];
      for (const g of range(groupsOf(n, 5))) {
        lines.push(`[Group ${g}]`);
        for (const i of range(Math.min(5, n - g * 5))) {
          lines.push(`  Svc${g * 5 + i} z: ${i % 2 ? 'inner' : 'outer'}`);
        }
      }
      for (const i of range(n)) {
        const j = (i + 1) % n;
        const k = (i * 7 + 3) % n;
        lines.push(`Svc${i} -call ${i}-> Svc${j}`);
        lines.push(`Svc${j} -> Svc${i}`);
        if (i % 3 === 0 && k !== i) lines.push(`Svc${i} ~event~> Svc${k}`);
        if (i % 10 === 0) lines.push(`note Step ${i}`);
      }
      return lines.join('\n');
    },
  },
  // n nodes in a chain with a decision every fifth node, back-links, one group per ten.
  flowchart: {
    gen: (n) => {
      const lines = ['flowchart Growth', '(Start) -> [Step 0]'];
      for (const i of range(n)) {
        if (i % 5 === 4 && i + 2 < n) {
          lines.push(`[Step ${i}] -> <Check ${i}?>`);
          lines.push(`<Check ${i}?> -yes-> [Step ${i + 1}]`);
          lines.push(`<Check ${i}?> -no-> [Step ${i + 2}]`);
        } else if ((i + 1 < n && i % 5 !== 0) || (i % 5 === 0 && i + 1 < n)) {
          lines.push(`[Step ${i}] -> [Step ${i + 1}]`);
        }
      }
      lines.push(`[Step ${n - 1}] -> (End)`);
      for (const g of range(groupsOf(n, 10))) {
        lines.push(`[Phase ${g}]`);
        for (const i of range(Math.min(10, n - g * 10)))
          lines.push(`  [Step ${g * 10 + i}]`);
      }
      return lines.join('\n');
    },
  },
  // n classes: a few bases, subclasses extending them, composition and usage links.
  class: {
    gen: (n) => {
      const lines = ['class Growth'];
      const bases = Math.max(2, Math.floor(n / 5));
      for (const i of range(n)) {
        lines.push(
          i < bases
            ? `Class${i} [abstract]`
            : `Class${i} extends Class${i % bases}`
        );
        lines.push(`  - id: number`, `  + name: string`, `  + run${i}(): void`);
        if (i >= bases && i % 2 === 0) lines.push(`  *-- Class${i - 1} : owns`);
        if (i % 3 === 0 && i > 0)
          lines.push(`  ..> Class${(i * 5) % n} : uses`);
      }
      return lines.join('\n');
    },
  },
  // n tables, each with columns, related to the previous and to a distant one.
  er: {
    gen: (n) => {
      const lines = ['er Growth'];
      for (const i of range(n)) {
        lines.push(
          `table_${i}`,
          `  id int pk`,
          `  name varchar`,
          `  parent_id int fk nullable`
        );
        if (i > 0) lines.push(`  *-belongs to-1 table_${i - 1}`);
        if (i % 4 === 0 && i > 3) lines.push(`  *-refs-1 table_${(i * 3) % i}`);
      }
      return lines.join('\n');
    },
  },
  // n states in groups of ten, a forward chain, retry loops and cross jumps.
  state: {
    gen: (n) => {
      const lines = ['state Growth', '[*] -> S0'];
      for (const g of range(groupsOf(n, 10))) {
        lines.push(`[Stage ${g}]`);
        for (const i of range(Math.min(10, n - g * 10))) {
          const s = g * 10 + i;
          lines.push(`  S${s}`);
          if (s + 1 < n) lines.push(`    -next ${s}-> S${s + 1}`);
          if (s % 4 === 0 && s > 0) lines.push(`    -retry-> S${s - 1}`);
          if (s % 7 === 0 && s + 5 < n) lines.push(`    -skip-> S${s + 5}`);
        }
      }
      lines.push(`S${n - 1} -> [*]`);
      return lines.join('\n');
    },
  },
  // n people in a tree, fanout 4, with tags and a team container per manager.
  org: {
    gen: (n) => {
      const lines = [
        'org Growth',
        'tag Location',
        '  NY blue',
        '  LA yellow',
        '  Remote purple',
      ];
      const depth = (i: number): number =>
        i === 0 ? 0 : 1 + depth(Math.floor((i - 1) / 4));
      const kids = (i: number) =>
        [1, 2, 3, 4].map((c) => i * 4 + c).filter((c) => c < n);
      const emit = (i: number) => {
        const ind = '  '.repeat(depth(i));
        lines.push(`${ind}Person ${i}`);
        lines.push(`${ind}  role: Role ${i % 6}`);
        lines.push(`${ind}  location: ${['NY', 'LA', 'Remote'][i % 3]}`);
        for (const c of kids(i)) emit(c);
      };
      emit(0);
      return lines.join('\n');
    },
  },
  // n cards over 5 columns, tags on each, a child line on every fourth.
  kanban: {
    gen: (n) => {
      const cols = ['Backlog', 'Ready', 'Doing', 'Review', 'Done'];
      const lines = [
        'kanban Growth',
        'tag Priority',
        '  Low green',
        '  High orange',
        '  Urgent red',
      ];
      for (const [c, name] of cols.entries()) {
        lines.push(`[${name}]`);
        for (let i = c; i < n; i += cols.length) {
          lines.push(
            `  Card ${i} priority: ${['Low', 'High', 'Urgent'][i % 3]}`
          );
          if (i % 4 === 0) lines.push(`    Detail for card ${i}`);
        }
      }
      return lines.join('\n');
    },
  },
  // n elements: people, systems with containers, linked in a ring plus cross links.
  c4: {
    gen: (n) => {
      const lines = ['c4 Growth'];
      for (const i of range(n)) {
        lines.push(`Sys${i} is a ${i % 5 === 0 ? 'person' : 'system'}`);
        lines.push(`  description: System number ${i}`);
        lines.push(`  -Uses ${i}-> Sys${(i + 1) % n}`);
        if (i % 3 === 0) lines.push(`  -Calls-> Sys${(i * 5 + 2) % n}`);
      }
      return lines.join('\n');
    },
  },
  // n pages in a tree (fanout 4) with arrows to children's siblings and cross links.
  sitemap: {
    gen: (n) => {
      const lines = [
        'sitemap Growth',
        'tag Auth',
        '  Public green',
        '  Required blue',
        '',
      ];
      const depth = (i: number): number =>
        i === 0 ? 0 : 1 + depth(Math.floor((i - 1) / 4));
      const kids = (i: number) =>
        [1, 2, 3, 4].map((c) => i * 4 + c).filter((c) => c < n);
      const emit = (i: number) => {
        const ind = '  '.repeat(depth(i));
        lines.push(`${ind}Doc${i}`);
        lines.push(`${ind}  Auth: ${i % 2 ? 'Public' : 'Required'}`);
        if (i % 3 === 0 && i > 0)
          lines.push(`${ind}  -see also-> Doc${(i * 7) % n}`);
        for (const c of kids(i)) emit(c);
      };
      emit(0);
      return lines.join('\n');
    },
  },
  // n components: an edge entry, a chain of services with splits and an async link.
  infra: {
    known: 'diagrammo/diagrammo#2026',
    gen: (n) => {
      const lines = ['infra Growth', 'edge', '  rps: 1000', '  -> Svc0'];
      for (const i of range(n)) {
        lines.push(`Svc${i}`);
        lines.push(`  description: Service ${i}`);
        lines.push(`  instances: 2`, `  max-rps: 800`, `  latency-ms: 20`);
        if (i + 2 < n && i % 3 === 0) {
          lines.push(
            `  -a-> Svc${i + 1} split: 60%`,
            `  -b-> Svc${i + 2} split: 40%`
          );
        } else if (i + 1 < n) {
          lines.push(`  -> Svc${i + 1}`);
        }
        if (i % 5 === 0 && i + 4 < n) lines.push(`  ~events~> Svc${i + 4}`);
      }
      return lines.join('\n');
    },
  },
  // n tasks in sections of ten, each depending on the previous, a few cross-section deps.
  gantt: {
    gen: (n) => {
      const lines = ['gantt Growth', 'start-date 2024-01-15'];
      for (const g of range(groupsOf(n, 10))) {
        lines.push(`[Section ${g}]`);
        for (const i of range(Math.min(10, n - g * 10))) {
          const t = g * 10 + i;
          lines.push(`  Task ${t} ${3 + (t % 5)}bd`);
          if (t % 4 === 0 && t + 2 < n && Math.floor((t + 2) / 10) === g)
            lines.push(`    -1bd-> Task ${t + 2}`);
        }
      }
      return lines.join('\n');
    },
  },
  // n activities, each leading to the next, fan-out to a later one every third.
  pert: {
    gen: (n) => {
      const lines = ['pert Growth', 'time-unit w'];
      const nm = (i: number) =>
        `Job ${i.toString(26).replace(/[0-9a-p]/g, (c) => String.fromCharCode(c.charCodeAt(0) + (c <= '9' ? 49 : 10)))}`;
      for (const i of range(n)) {
        lines.push(`${nm(i)} ${1 + (i % 3)} ${2 + (i % 3)} ${4 + (i % 3)}`);
        if (i + 1 < n) lines.push(`  -> ${nm(i + 1)}`);
        if (i % 3 === 0 && i + 4 < n) lines.push(`  -> ${nm(i + 4)}`);
      }
      return lines.join('\n');
    },
  },
  // n boxes, tagged, each linked to the next with labels, cross links every fourth.
  'boxes-and-lines': {
    gen: (n) => {
      const lines = [
        'boxes-and-lines Growth',
        'tag Team as t Backend blue, Frontend green, Platform purple',
      ];
      for (const i of range(n)) {
        lines.push(`Box${i} t: ${['Backend', 'Frontend', 'Platform'][i % 3]}`);
        if (i + 1 < n) lines.push(`  -calls-> Box${i + 1}`);
        if (i % 4 === 0 && i + 3 < n) lines.push(`  -> Box${i + 3}`);
        if (i % 6 === 0 && i > 5) lines.push(`  -reads-> Box${i - 5}`);
      }
      return lines.join('\n');
    },
  },
  // n nodes over 4 lanes, in steps of four (one node per lane), chained with branches.
  swimlane: {
    gen: (n) => {
      const lanes = ['Customer', 'Agent', 'Adjuster', 'Payments'];
      const lines = ['swimlane Growth', 'direction-lr'];
      for (const l of lanes) lines.push(`lane ${l}`);
      for (const g of range(groupsOf(n, 4))) {
        lines.push(`[Step ${g}]`);
        for (const i of range(Math.min(4, n - g * 4))) {
          lines.push(`  ${lanes[i]}`, `    Task ${g * 4 + i}`);
        }
      }
      for (const i of range(n - 1)) {
        lines.push(`Task ${i} -> Task ${i + 1}`);
        if (i % 5 === 0 && i + 3 < n)
          lines.push(`Task ${i} -skip-> Task ${i + 3}`);
      }
      return lines.join('\n');
    },
  },
  // n people across generations: couples with children, children marry into new couples.
  family: {
    gen: (n) => {
      const lines = ['family Growth'];
      const people = Math.max(2, n);
      for (const i of range(people))
        lines.push(`Person${i} b: ${1800 + i * 3}, sex: ${i % 2 ? 'm' : 'f'}`);
      // couple (2c, 2c+1) has children 2(2c+2).. i.e. next couples
      for (let c = 0; 2 * c + 1 < people; c++) {
        lines.push(`Person${2 * c} + Person${2 * c + 1} m: ${1820 + c * 3}`);
        for (const k of [2 * c + 2, 2 * c + 3])
          if (k < people && k > 2 * c + 1 && c < Math.floor(people / 4))
            lines.push(`  Person${k}`);
      }
      return lines.join('\n');
    },
  },
  // n commits over a main and feature branches with merges back.
  'version-control': {
    gen: (n) => {
      const lines = ['version-control Growth', 'main', '  Initial commit'];
      let c = 1;
      let f = 0;
      while (c < n) {
        lines.push(`feature/f${f} from main`);
        for (let j = 0; j < 3; j++) lines.push(`  Commit ${c++}`);
        lines.push('main', `  merge feature/f${f}`);
        c++;
        f++;
      }
      return lines.join('\n');
    },
  },
  // n topics in a tree, fanout 4, some tagged.
  mindmap: {
    gen: (n) => {
      const lines = [
        'mindmap Growth',
        'tag Priority as p',
        '  Must red',
        '  Could green',
      ];
      const depth = (i: number): number =>
        i === 0 ? 0 : 1 + depth(Math.floor((i - 1) / 4));
      const kids = (i: number) =>
        [1, 2, 3, 4].map((c) => i * 4 + c).filter((c) => c < n);
      const emit = (i: number) => {
        lines.push(
          `${'  '.repeat(depth(i))}Topic ${i}${i % 3 === 0 ? ` p: ${i % 2 ? 'Must' : 'Could'}` : ''}`
        );
        for (const c of kids(i)) emit(c);
      };
      emit(0);
      return lines.join('\n');
    },
  },
};

export const NOT_SCALABLE_A: Record<string, string> = {};
