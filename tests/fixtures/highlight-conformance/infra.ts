import type { HighlightFixture } from './_types';

export const fixture: HighlightFixture = {
  chartType: 'infra',
  specSection: '4',
  source: `infra
direction-tb
default-rps 1000
default-latency-ms 50
default-uptime 0.99
slo-availability 0.999
slo-p90-latency-ms 100
animate
active-tag X

edge
  rps: 10000
  -> CDN

API
  latency-ms: 50
  uptime: 0.99
`,
  assertions: [
    { text: 'infra', role: 'chartType' },
    { text: 'direction-tb', role: 'keyword' },
    { text: 'default-rps', role: 'keyword' },
    { text: 'default-latency-ms', role: 'keyword' },
    { text: 'default-uptime', role: 'keyword' },
    // Top-level SLO options stay bare directives (space-separated form).
    { text: 'slo-availability', role: 'keyword' },
    { text: 'slo-p90-latency-ms', role: 'keyword' },
    { text: 'animate', role: 'keyword' },
    { text: 'active-tag', role: 'keyword' },
    // Node behavior colon-keys are now property names, not bare directives.
    { text: 'rps', role: 'propertyName' },
    { text: 'latency-ms', role: 'propertyName' },
    { text: 'uptime', role: 'propertyName' },
  ],
};
