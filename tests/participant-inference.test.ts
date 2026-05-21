import { describe, it, expect } from 'vitest';
import {
  inferParticipantType,
  RULE_COUNT,
} from '../src/sequence/participant-inference';

// ────────────────────────────────────────────────────────────
// Rule count assertion
// ────────────────────────────────────────────────────────────
//
// Post-0.16.0 trim: inference is intentionally conservative and
// only covers the 4 surviving special-shape types (actor, database,
// cache, queue). The previous ~250-rule table mapping names to
// service/frontend/networking/gateway/external was removed when
// those types were collapsed into the default rectangle.

describe('RULE_COUNT', () => {
  it('matches the actual number of rules in the table', () => {
    expect(RULE_COUNT).toBe(82);
  });

  it('is well under the pre-trim count (regression guard)', () => {
    expect(RULE_COUNT).toBeLessThan(100);
  });
});

// ────────────────────────────────────────────────────────────
// Database
// ────────────────────────────────────────────────────────────

describe('database inference', () => {
  it.each([
    ['UserDB', 'database'],
    ['Database', 'database'],
    ['Datastore', 'database'],
    ['SessionStore', 'database'],
    ['BlobStorage', 'database'],
    ['UserRepo', 'database'],
    ['Repository', 'database'],
    ['SQL', 'database'],
    ['Postgres', 'database'],
    ['MySQL', 'database'],
    ['Mongo', 'database'],
    ['DynamoDB', 'database'],
    ['Aurora', 'database'],
    ['Spanner', 'database'],
    ['Supabase', 'database'],
    ['Firebase', 'database'],
    ['BigQuery', 'database'],
    ['Redshift', 'database'],
    ['Snowflake', 'database'],
    ['Cassandra', 'database'],
    ['Neo4j', 'database'],
    ['ClickHouse', 'database'],
    ['Elastic', 'database'],
    ['OpenSearch', 'database'],
    ['Pinecone', 'database'],
    ['OrdersTable', 'database'],
    ['CockroachDB', 'database'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Cache
// ────────────────────────────────────────────────────────────

describe('cache inference', () => {
  it.each([
    ['Cache', 'cache'],
    ['Redis', 'cache'],
    ['Memcached', 'cache'],
    ['Dragonfly', 'cache'],
    ['Hazelcast', 'cache'],
    ['Valkey', 'cache'],
    ['KeyDB', 'cache'], // conflict override — not database
    ['RedisCache', 'cache'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Queue / Messaging
// ────────────────────────────────────────────────────────────

describe('queue inference', () => {
  it.each([
    ['TaskQueue', 'queue'],
    ['ActiveMQ', 'queue'],
    ['SQS', 'queue'],
    ['Kafka', 'queue'],
    ['RabbitMQ', 'queue'],
    ['EventBus', 'queue'],
    ['MessageBus', 'queue'],
    ['ServiceBus', 'queue'],
    ['Topic', 'queue'],
    ['DataStream', 'queue'],
    ['SNS', 'queue'],
    ['PubSub', 'queue'],
    ['MessageBroker', 'queue'], // Broker$ kept in queue section
    ['NATS', 'queue'],
    ['Pulsar', 'queue'],
    ['Kinesis', 'queue'],
    ['EventBridge', 'queue'],
    ['Celery', 'queue'],
    ['Sidekiq', 'queue'],
    ['EventHub', 'queue'],
    ['NotificationChannel', 'queue'],
    ['BullMQ', 'queue'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Actor
// ────────────────────────────────────────────────────────────

describe('actor inference', () => {
  it.each([
    ['Admin', 'actor'],
    ['User', 'actor'],
    ['Customer', 'actor'],
    ['Agent', 'actor'],
    ['Person', 'actor'],
    ['Buyer', 'actor'],
    ['Seller', 'actor'],
    ['Guest', 'actor'],
    ['Visitor', 'actor'],
    ['Operator', 'actor'],
    ['Developer', 'actor'],
    ['Alice', 'actor'],
    ['Bob', 'actor'],
    ['Charlie', 'actor'],
    ['Fan', 'actor'],
    ['Purchaser', 'actor'],
    ['Reviewer', 'actor'],
    ['EndUser', 'actor'],
    ['SystemActor', 'actor'],
    ['DataAnalyst', 'actor'],
    ['SupportStaff', 'actor'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Case insensitivity
// ────────────────────────────────────────────────────────────

describe('case insensitivity', () => {
  it.each([
    ['redis', 'cache'],
    ['REDIS', 'cache'],
    ['Redis', 'cache'],
    ['kafka', 'queue'],
    ['KAFKA', 'queue'],
    ['postgres', 'database'],
    ['POSTGRES', 'database'],
    ['alice', 'actor'],
    ['ALICE', 'actor'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Default fall-through — names that previously inferred to
// removed types now collapse to default
// ────────────────────────────────────────────────────────────

describe('default fall-through (post-0.16.0 trim)', () => {
  it.each([
    // Names that previously inferred to `service`
    'AuthService',
    'PaymentService',
    'RestAPI',
    'Lambda',
    'Stripe',
    'Twilio',
    'Vercel',
    'Docker',
    'Kubernetes',
    'Vault',
    'Auth',
    'SSO',
    'OAuth',
    'S3',
    'GPT',
    'DataPipeline',
    'SearchEngine',
    'Daemon',
    'TaskScheduler',
    'WebServer',
    'EventDispatcher',
    // Names that previously inferred to `frontend`
    'WebApp',
    'MobileApp',
    'Application',
    'iOS',
    'Android',
    'Browser',
    'Dashboard',
    'AdminUI',
    'React',
    'Vue',
    'Electron',
    'SPA',
    // Names that previously inferred to `networking`
    'ApiGateway',
    'API Gateway',
    'LoadBalancer',
    'Cloudflare',
    'Nginx',
    'Istio',
    'CDN',
    'Firewall',
    'WAF',
    'DNS',
    'ServiceMesh',
    // Names that previously inferred to `external`
    'External',
    'ThirdParty',
    'Webhook',
    'Vendor',
    'AWS',
    'GCP',
    'Azure',
    // Generic fall-through
    'Foo',
    'Bar',
    'Payments',
    'Orders',
    'Inventory',
    'Acme',
  ])('%s → default', (name) => {
    expect(inferParticipantType(name)).toBe('default');
  });
});
