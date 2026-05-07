import type { ConformanceFixture } from './_types';

// Spec §4 §3.6 Infra Options. Many performance/SLO knobs.
// `slo-warning-margin` is in completion but not §3.6 — kept under
// allowExtras until either spec catches up or the option is removed.
export const fixture: ConformanceFixture = {
  chartType: 'infra',
  specSection: '4',
  firstLineKeyword: 'infra',
  directives: [
    'direction-tb',
    'default-latency-ms',
    'default-rps',
    'default-uptime',
    'slo-availability',
    'slo-p90-latency-ms',
    'animate',
    'no-animate',
    'active-tag',
  ],
  pipeKeys: {
    node: [
      'description',
      'instances',
      'latency-ms',
      'max-rps',
      'cache-hit',
      'firewall-block',
      'ratelimit-rps',
      'cb-error-threshold',
      'cb-latency-threshold-ms',
      'uptime',
      'concurrency',
      'duration-ms',
      'cold-start-ms',
      'buffer',
      'drain-rate',
      'retention-hours',
      'partitions',
      'slo-availability',
      'slo-p90-latency-ms',
      'slo-warning-margin',
    ],
    edge: ['split', 'fanout'],
  },
  allowExtras: ['slo-warning-margin'],
  enumChecks: [{ directive: 'palette', source: 'palettes' }],
};
