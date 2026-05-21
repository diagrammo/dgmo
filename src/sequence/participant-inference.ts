// ============================================================
// Participant Type Inference Engine
// ============================================================
//
// Data-driven rules table that infers participant type from name.
// First match wins. Conflict overrides come before suffix rules
// to prevent false positives within the surviving 4-type taxonomy.
//
// Surviving types: actor, database, cache, queue (plus default).
// Removed in 0.16.0: service, frontend, networking, gateway, external.
// Names that previously inferred to a removed type fall through to
// default (sharp rectangle). Inference is intentionally conservative
// — narrow product/name lists, no broad suffix catch-alls.
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
 * 0. Conflict overrides (prevent misclassification by general patterns)
 * 1. Database patterns
 * 2. Cache patterns
 * 3. Queue/Messaging patterns
 * 4. Actor patterns (suffix + exact)
 */
const PARTICIPANT_RULES: readonly InferenceRule[] = [
  // ── 0. Conflict overrides ────────────────────────────────
  // Names that would incorrectly match general patterns in later groups
  { pattern: /^KeyDB$/i, type: 'cache' }, // not database (DB$ suffix)

  // ── 1. Database patterns ────────────────────────────────
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
  // Named products & patterns
  { pattern: /^Aurora$/i, type: 'database' },
  { pattern: /Spanner/i, type: 'database' },
  { pattern: /Supabase/i, type: 'database' },
  { pattern: /Firebase/i, type: 'database' },
  { pattern: /BigQuery/i, type: 'database' },
  { pattern: /Redshift/i, type: 'database' },
  { pattern: /Snowflake/i, type: 'database' },
  { pattern: /Cassandra/i, type: 'database' },
  { pattern: /Neo4j/i, type: 'database' },
  { pattern: /ClickHouse/i, type: 'database' },
  { pattern: /Elastic/i, type: 'database' },
  { pattern: /OpenSearch/i, type: 'database' },
  { pattern: /Druid/i, type: 'database' },
  { pattern: /Trino/i, type: 'database' },
  { pattern: /Pinecone/i, type: 'database' },
  { pattern: /Weaviate/i, type: 'database' },
  { pattern: /Qdrant/i, type: 'database' },
  { pattern: /Milvus/i, type: 'database' },
  { pattern: /Presto/i, type: 'database' },
  { pattern: /Table$/i, type: 'database' },

  // ── 2. Cache patterns ──────────────────────────────────
  { pattern: /Cache/i, type: 'cache' },
  { pattern: /Redis/i, type: 'cache' },
  { pattern: /Memcache/i, type: 'cache' },
  // Named products
  { pattern: /Dragonfly/i, type: 'cache' },
  { pattern: /Hazelcast/i, type: 'cache' },
  { pattern: /Valkey/i, type: 'cache' },

  // ── 3. Queue/Messaging patterns ─────────────────────────
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
  { pattern: /Broker$/i, type: 'queue' },
  // Named products & patterns
  { pattern: /NATS/i, type: 'queue' },
  { pattern: /Pulsar/i, type: 'queue' },
  { pattern: /Kinesis/i, type: 'queue' },
  { pattern: /EventBridge/i, type: 'queue' },
  { pattern: /CloudEvents/i, type: 'queue' },
  { pattern: /Celery/i, type: 'queue' },
  { pattern: /Sidekiq/i, type: 'queue' },
  { pattern: /EventHub/i, type: 'queue' },
  { pattern: /Channel$/i, type: 'queue' },

  // ── 4. Actor patterns ──────────────────────────────────
  // Exact matches first
  { pattern: /^Admin$/i, type: 'actor' },
  { pattern: /^User$/i, type: 'actor' },
  { pattern: /^Customer$/i, type: 'actor' },
  { pattern: /^Agent$/i, type: 'actor' },
  { pattern: /^Person$/i, type: 'actor' },
  { pattern: /^Buyer$/i, type: 'actor' },
  { pattern: /^Seller$/i, type: 'actor' },
  { pattern: /^Guest$/i, type: 'actor' },
  { pattern: /^Visitor$/i, type: 'actor' },
  { pattern: /^Operator$/i, type: 'actor' },
  { pattern: /^Developer$/i, type: 'actor' },
  { pattern: /^Alice$/i, type: 'actor' },
  { pattern: /^Bob$/i, type: 'actor' },
  { pattern: /^Charlie$/i, type: 'actor' },
  { pattern: /^Fan$/i, type: 'actor' },
  { pattern: /^Purchaser$/i, type: 'actor' },
  { pattern: /^Reviewer$/i, type: 'actor' },
  // Suffix rules
  { pattern: /User$/i, type: 'actor' },
  { pattern: /Actor$/i, type: 'actor' },
  { pattern: /Analyst$/i, type: 'actor' },
  { pattern: /Staff$/i, type: 'actor' },
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
