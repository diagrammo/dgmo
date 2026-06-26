import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const svgStr = readFileSync('/tmp/d3spike/line_d3.svg', 'utf8');
const dom = new JSDOM(`<!DOCTYPE html><body><div id="c">${svgStr}</div></body>`, { url: 'http://localhost/' });
const { window } = dom;
global.window = window; global.document = window.document;
global.getComputedStyle = window.getComputedStyle.bind(window);
const { attachDataChartInteractions } = require('/tmp/d3spike/interactions.cjs');
const svg = window.document.querySelector('svg');
let navigated = null;
const detach = attachDataChartInteractions(svg, { onNavigate: (n) => (navigated = n) });

const plot = svg.querySelector('.dgmo-plot-rect');
const Mouse = window.MouseEvent;
plot.dispatchEvent(new Mouse('mousemove', { bubbles: true, clientX: 200, clientY: 200 }));

const checks = [];
checks.push(['crosshair line drawn', !!svg.querySelector('.dgmo-crosshair')]);
const tip = window.document.querySelector('#c > div');
checks.push(['tooltip created + shown', !!tip && tip.style.display === 'block']);
checks.push(['tooltip lists both series', /iOS/.test(tip?.innerHTML) && /Android/.test(tip?.innerHTML)]);
const enlarged = [...svg.querySelectorAll('.dgmo-pt')].some(c => parseFloat(c.getAttribute('r')) > 3.5);
checks.push(['active points enlarged', enlarged]);
const dimmed = [...svg.querySelectorAll('.dgmo-series')].some(g => g.classList.contains('dgmo-dim'));
checks.push(['non-hovered series dimmed', dimmed]);

const pt = svg.querySelector('.dgmo-pt[data-line-number="8"]');
pt.dispatchEvent(new Mouse('click', { bubbles: true }));
checks.push(['click → onNavigate(8)', navigated === 8]);

plot.dispatchEvent(new Mouse('mouseleave', { bubbles: true }));
checks.push(['mouseleave clears crosshair', svg.querySelector('.dgmo-crosshair')?.style.display === 'none']);
checks.push(['mouseleave clears dim', ![...svg.querySelectorAll('.dgmo-series')].some(g => g.classList.contains('dgmo-dim'))]);
detach();

let ok = true;
for (const [name, pass] of checks) { console.log((pass ? '✓' : '✗') + ' ' + name); if (!pass) ok = false; }
process.exit(ok ? 0 : 1);
