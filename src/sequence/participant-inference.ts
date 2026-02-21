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
 * 0. Conflict overrides (prevent misclassification by general patterns)
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
  // ── 0. Conflict overrides ────────────────────────────────
  // Names that would incorrectly match general patterns in later groups
  { pattern: /^KeyDB$/i, type: 'cache' }, // not database (DB$ suffix)
  { pattern: /Webhook/i, type: 'external' }, // not frontend (Web contains)
  { pattern: /^Upstream$/i, type: 'external' }, // not queue (Stream$ suffix)
  { pattern: /^Downstream$/i, type: 'external' }, // not queue (Stream$ suffix)

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
  // New -er/-or suffixes that are services, not actors
  { pattern: /^.*Watcher$/i, type: 'service' },
  { pattern: /^.*Executor$/i, type: 'service' },
  { pattern: /^.*Aggregator$/i, type: 'service' },
  { pattern: /^.*Collector$/i, type: 'service' },
  { pattern: /^.*Transformer$/i, type: 'service' },
  { pattern: /^.*Validator$/i, type: 'service' },
  { pattern: /^.*Generator$/i, type: 'service' },
  { pattern: /^.*Indexer$/i, type: 'service' },
  { pattern: /^.*Crawler$/i, type: 'service' },
  { pattern: /^.*Scanner$/i, type: 'service' },
  { pattern: /^.*Parser$/i, type: 'service' },
  { pattern: /^.*Emitter$/i, type: 'service' },
  { pattern: /^.*Exporter$/i, type: 'service' },
  { pattern: /^.*Importer$/i, type: 'service' },
  { pattern: /^.*Loader$/i, type: 'service' },
  { pattern: /^.*Renderer$/i, type: 'service' },
  { pattern: /^.*Checker$/i, type: 'service' },
  { pattern: /^.*Inspector$/i, type: 'service' },
  { pattern: /^.*Encoder$/i, type: 'service' },
  { pattern: /^.*Decoder$/i, type: 'service' },
  { pattern: /^.*Notifier$/i, type: 'service' },

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
  // Named products & patterns
  { pattern: /Nginx/i, type: 'networking' },
  { pattern: /Traefik/i, type: 'networking' },
  { pattern: /Envoy/i, type: 'networking' },
  { pattern: /Istio/i, type: 'networking' },
  { pattern: /Kong/i, type: 'networking' },
  { pattern: /Akamai/i, type: 'networking' },
  { pattern: /Cloudflare/i, type: 'networking' },
  { pattern: /Mesh$/i, type: 'networking' },
  { pattern: /ServiceMesh/i, type: 'networking' },

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

  // ── 4. Cache patterns ──────────────────────────────────
  { pattern: /Cache/i, type: 'cache' },
  { pattern: /Redis/i, type: 'cache' },
  { pattern: /Memcache/i, type: 'cache' },
  // CDN already matched by networking above
  // Named products
  { pattern: /Dragonfly/i, type: 'cache' },
  { pattern: /Hazelcast/i, type: 'cache' },
  { pattern: /Valkey/i, type: 'cache' },

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
  { pattern: /^Fan$/i, type: 'actor' },
  { pattern: /^Purchaser$/i, type: 'actor' },
  { pattern: /^Reviewer$/i, type: 'actor' },
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
  // Frameworks & patterns
  { pattern: /React/i, type: 'frontend' },
  { pattern: /^Vue$/i, type: 'frontend' },
  { pattern: /Angular/i, type: 'frontend' },
  { pattern: /Svelte/i, type: 'frontend' },
  { pattern: /NextJS/i, type: 'frontend' },
  { pattern: /Nuxt/i, type: 'frontend' },
  { pattern: /Remix/i, type: 'frontend' },
  { pattern: /Electron/i, type: 'frontend' },
  { pattern: /Tauri/i, type: 'frontend' },
  { pattern: /Widget$/i, type: 'frontend' },
  { pattern: /Portal/i, type: 'frontend' },
  { pattern: /Console$/i, type: 'frontend' },
  { pattern: /^SPA$/i, type: 'frontend' },
  { pattern: /^PWA$/i, type: 'frontend' },

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
  // Auth
  { pattern: /^Auth$/i, type: 'service' },
  { pattern: /^AuthN$/i, type: 'service' },
  { pattern: /^AuthZ$/i, type: 'service' },
  { pattern: /^SSO$/i, type: 'service' },
  { pattern: /OAuth/i, type: 'service' },
  { pattern: /^OIDC$/i, type: 'service' },
  // SaaS
  { pattern: /Stripe/i, type: 'service' },
  { pattern: /Twilio/i, type: 'service' },
  { pattern: /SendGrid/i, type: 'service' },
  { pattern: /Mailgun/i, type: 'service' },
  // Cloud/infra
  { pattern: /^S3$/i, type: 'service' },
  { pattern: /^Blob$/i, type: 'service' },
  { pattern: /Vercel/i, type: 'service' },
  { pattern: /Netlify/i, type: 'service' },
  { pattern: /Heroku/i, type: 'service' },
  { pattern: /Docker/i, type: 'service' },
  { pattern: /Kubernetes/i, type: 'service' },
  { pattern: /K8s/i, type: 'service' },
  { pattern: /Terraform/i, type: 'service' },
  // Security
  { pattern: /Vault/i, type: 'service' },
  { pattern: /^HSM$/i, type: 'service' },
  { pattern: /KMS/i, type: 'service' },
  { pattern: /^IAM$/i, type: 'service' },
  // AI/ML
  { pattern: /^LLM$/i, type: 'service' },
  { pattern: /GPT/i, type: 'service' },
  { pattern: /^Claude$/i, type: 'service' },
  { pattern: /Embedding/i, type: 'service' },
  { pattern: /Inference/i, type: 'service' },
  // Suffixes & patterns
  { pattern: /Pipeline$/i, type: 'service' },
  { pattern: /Registry/i, type: 'service' },
  { pattern: /Engine$/i, type: 'service' },
  { pattern: /Daemon/i, type: 'service' },

  // ── 9. External patterns ────────────────────────────────
  { pattern: /External/i, type: 'external' },
  { pattern: /Ext$/i, type: 'external' },
  { pattern: /ThirdParty/i, type: 'external' },
  { pattern: /3P$/i, type: 'external' },
  { pattern: /Vendor/i, type: 'external' },
  // Named products & patterns
  { pattern: /Callback/i, type: 'external' },
  { pattern: /^AWS$/i, type: 'external' },
  { pattern: /^GCP$/i, type: 'external' },
  { pattern: /Azure/i, type: 'external' },
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
