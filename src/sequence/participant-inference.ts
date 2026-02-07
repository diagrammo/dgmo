// ============================================================
// Participant Type Inference Engine
// ============================================================
//
// Data-driven rules table that infers participant type from name.
// First match wins. Infrastructure overrides come before suffix
// rules to prevent false positives (e.g. "Router" → networking,
// not actor despite the "-er" suffix).
// ============================================================

import type { ParticipantType } from './parser';

/**
 * A single inference rule: regex pattern → participant type.
 */
interface InferenceRule {
  pattern: RegExp;
  type: ParticipantType;
}

/**
 * Ordered rules table. First match wins.
 *
 * Priority order:
 * 1. Infrastructure overrides (prevent false actor matches)
 * 2. Networking patterns
 * 3. Database patterns
 * 4. Cache patterns
 * 5. Queue/Messaging patterns
 * 6. Actor patterns (suffix + exact)
 * 7. Frontend patterns
 * 8. Service patterns
 * 9. External patterns
 */
const PARTICIPANT_RULES: readonly InferenceRule[] = [
  // ── 1. Infrastructure overrides ─────────────────────────
  // These names end in -er/-or but are NOT actors
  { pattern: /^.*Router$/i, type: 'networking' },
  { pattern: /^.*Scheduler$/i, type: 'service' },
  { pattern: /^.*Dispatcher$/i, type: 'service' },
  { pattern: /^.*Balancer$/i, type: 'networking' },
  { pattern: /^.*Controller$/i, type: 'service' },
  { pattern: /^.*Handler$/i, type: 'service' },
  { pattern: /^.*Processor$/i, type: 'service' },
  { pattern: /^.*Connector$/i, type: 'service' },
  { pattern: /^.*Adapter$/i, type: 'service' },
  { pattern: /^.*Provider$/i, type: 'service' },
  { pattern: /^.*Manager$/i, type: 'service' },
  { pattern: /^.*Orchestrator$/i, type: 'service' },
  { pattern: /^.*Monitor$/i, type: 'service' },
  { pattern: /^.*Resolver$/i, type: 'service' },
  { pattern: /^.*Logger$/i, type: 'service' },
  { pattern: /^.*Server$/i, type: 'service' },
  { pattern: /^.*Broker$/i, type: 'queue' },
  { pattern: /^.*Worker$/i, type: 'service' },
  { pattern: /^.*Consumer$/i, type: 'service' },
  { pattern: /^.*Producer$/i, type: 'service' },
  { pattern: /^.*Publisher$/i, type: 'service' },
  { pattern: /^.*Subscriber$/i, type: 'service' },
  { pattern: /^.*Listener$/i, type: 'service' },

  // ── 2. Networking patterns ──────────────────────────────
  { pattern: /Gateway/i, type: 'networking' },
  { pattern: /GW$/i, type: 'networking' },
  { pattern: /Proxy/i, type: 'networking' },
  { pattern: /LB$/i, type: 'networking' },
  { pattern: /LoadBalancer/i, type: 'networking' },
  { pattern: /CDN/i, type: 'networking' },
  { pattern: /Firewall/i, type: 'networking' },
  { pattern: /WAF$/i, type: 'networking' },
  { pattern: /DNS/i, type: 'networking' },
  { pattern: /Ingress/i, type: 'networking' },

  // ── 3. Database patterns ────────────────────────────────
  { pattern: /DB$/i, type: 'database' },
  { pattern: /Database/i, type: 'database' },
  { pattern: /Datastore/i, type: 'database' },
  { pattern: /Store$/i, type: 'database' },
  { pattern: /Storage/i, type: 'database' },
  { pattern: /Repo$/i, type: 'database' },
  { pattern: /Repository/i, type: 'database' },
  { pattern: /SQL/i, type: 'database' },
  { pattern: /Postgres/i, type: 'database' },
  { pattern: /MySQL/i, type: 'database' },
  { pattern: /Mongo/i, type: 'database' },
  { pattern: /Dynamo/i, type: 'database' },

  // ── 4. Cache patterns ──────────────────────────────────
  { pattern: /Cache/i, type: 'cache' },
  { pattern: /Redis/i, type: 'cache' },
  { pattern: /Memcache/i, type: 'cache' },
  // CDN already matched by networking above

  // ── 5. Queue/Messaging patterns ─────────────────────────
  { pattern: /Queue/i, type: 'queue' },
  { pattern: /MQ$/i, type: 'queue' },
  { pattern: /SQS/i, type: 'queue' },
  { pattern: /Kafka/i, type: 'queue' },
  { pattern: /RabbitMQ/i, type: 'queue' },
  { pattern: /EventBus/i, type: 'queue' },
  { pattern: /MessageBus/i, type: 'queue' },
  { pattern: /Bus$/i, type: 'queue' },
  { pattern: /Topic/i, type: 'queue' },
  { pattern: /Stream$/i, type: 'queue' },
  { pattern: /SNS/i, type: 'queue' },
  { pattern: /PubSub/i, type: 'queue' },

  // ── 6. Actor patterns ──────────────────────────────────
  // Exact matches first
  { pattern: /^Admin$/i, type: 'actor' },
  { pattern: /^User$/i, type: 'actor' },
  { pattern: /^Customer$/i, type: 'actor' },
  { pattern: /^Client$/i, type: 'actor' },
  { pattern: /^Agent$/i, type: 'actor' },
  { pattern: /^Person$/i, type: 'actor' },
  { pattern: /^Buyer$/i, type: 'actor' },
  { pattern: /^Seller$/i, type: 'actor' },
  { pattern: /^Guest$/i, type: 'actor' },
  { pattern: /^Visitor$/i, type: 'actor' },
  { pattern: /^Operator$/i, type: 'actor' },
  { pattern: /^Alice$/i, type: 'actor' },
  { pattern: /^Bob$/i, type: 'actor' },
  { pattern: /^Charlie$/i, type: 'actor' },
  // Suffix rules (after infrastructure overrides filtered above)
  { pattern: /User$/i, type: 'actor' },
  { pattern: /Actor$/i, type: 'actor' },
  { pattern: /Analyst$/i, type: 'actor' },

  // ── 7. Frontend patterns ────────────────────────────────
  { pattern: /App$/i, type: 'frontend' },
  { pattern: /Application/i, type: 'frontend' },
  { pattern: /Mobile/i, type: 'frontend' },
  { pattern: /iOS/i, type: 'frontend' },
  { pattern: /Android/i, type: 'frontend' },
  { pattern: /Web/i, type: 'frontend' },
  { pattern: /Browser/i, type: 'frontend' },
  { pattern: /Frontend/i, type: 'frontend' },
  { pattern: /UI$/i, type: 'frontend' },
  { pattern: /Dashboard/i, type: 'frontend' },
  { pattern: /CLI$/i, type: 'frontend' },
  { pattern: /Terminal/i, type: 'frontend' },

  // ── 8. Service patterns ─────────────────────────────────
  { pattern: /Service/i, type: 'service' },
  { pattern: /Svc$/i, type: 'service' },
  { pattern: /API$/i, type: 'service' },
  { pattern: /Lambda/i, type: 'service' },
  { pattern: /Function$/i, type: 'service' },
  { pattern: /Fn$/i, type: 'service' },
  { pattern: /Job$/i, type: 'service' },
  { pattern: /Cron/i, type: 'service' },
  { pattern: /Microservice/i, type: 'service' },

  // ── 9. External patterns ────────────────────────────────
  { pattern: /External/i, type: 'external' },
  { pattern: /Ext$/i, type: 'external' },
  { pattern: /ThirdParty/i, type: 'external' },
  { pattern: /3P$/i, type: 'external' },
  { pattern: /Vendor/i, type: 'external' },
];

/**
 * Infer participant type from a name using the ordered rules table.
 * Returns 'default' if no rule matches.
 */
export function inferParticipantType(name: string): ParticipantType {
  for (const rule of PARTICIPANT_RULES) {
    if (rule.pattern.test(name)) {
      return rule.type;
    }
  }
  return 'default';
}

/**
 * Number of rules in the table. Exported for test assertions.
 */
export const RULE_COUNT = PARTICIPANT_RULES.length;
