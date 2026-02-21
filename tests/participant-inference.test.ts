import { describe, it, expect } from 'vitest';
import { inferParticipantType, RULE_COUNT } from '../src/sequence/participant-inference';

// ────────────────────────────────────────────────────────────
// Rule count assertion
// ────────────────────────────────────────────────────────────

describe('RULE_COUNT', () => {
  it('matches the actual number of rules in the table', () => {
    expect(RULE_COUNT).toBe(222);
  });
});

// ────────────────────────────────────────────────────────────
// Regression guard — all pre-existing 125 name→type pairs
// ────────────────────────────────────────────────────────────

describe('regression guard — original rules', () => {
  // Group 1: Infrastructure overrides (22 rules)
  it.each([
    ['ApiRouter', 'networking'],
    ['TaskScheduler', 'service'],
    ['EventDispatcher', 'service'],
    ['LoadBalancer', 'networking'],
    ['AuthController', 'service'],
    ['RequestHandler', 'service'],
    ['DataProcessor', 'service'],
    ['DbConnector', 'service'],
    ['PaymentAdapter', 'service'],
    ['CloudProvider', 'service'],
    ['CacheManager', 'service'],
    ['ServiceOrchestrator', 'service'],
    ['HealthMonitor', 'service'],
    ['DnsResolver', 'service'],
    ['AccessLogger', 'service'],
    ['WebServer', 'service'],
    ['MessageBroker', 'queue'],
    ['BackgroundWorker', 'service'],
    ['EventConsumer', 'service'],
    ['DataProducer', 'service'],
    ['EventPublisher', 'service'],
    ['TopicSubscriber', 'service'],
    ['PortListener', 'service'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 2: Networking (10 rules)
  it.each([
    ['ApiGateway', 'networking'],
    ['PaymentGW', 'networking'],
    ['ReverseProxy', 'networking'],
    ['AppLB', 'networking'],
    ['LoadBalancer', 'networking'],
    ['CDN', 'networking'],
    ['Firewall', 'networking'],
    ['WAF', 'networking'],
    ['DNS', 'networking'],
    ['Ingress', 'networking'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 3: Database (12 rules)
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
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 4: Cache (3 rules)
  it.each([
    ['Cache', 'cache'],
    ['Redis', 'cache'],
    ['Memcached', 'cache'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 5: Queue/Messaging (12 rules)
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
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 6: Actor (17 rules — 14 exact + 3 suffix)
  it.each([
    ['Admin', 'actor'],
    ['User', 'actor'],
    ['Customer', 'actor'],
    ['Client', 'actor'],
    ['Agent', 'actor'],
    ['Person', 'actor'],
    ['Buyer', 'actor'],
    ['Seller', 'actor'],
    ['Guest', 'actor'],
    ['Visitor', 'actor'],
    ['Operator', 'actor'],
    ['Alice', 'actor'],
    ['Bob', 'actor'],
    ['Charlie', 'actor'],
    ['EndUser', 'actor'],
    ['SystemActor', 'actor'],
    ['DataAnalyst', 'actor'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 7: Frontend (12 rules)
  it.each([
    ['MobileApp', 'frontend'],
    ['Application', 'frontend'],
    ['Mobile', 'frontend'],
    ['iOS', 'frontend'],
    ['Android', 'frontend'],
    ['WebUI', 'frontend'],
    ['Browser', 'frontend'],
    ['Frontend', 'frontend'],
    ['AdminUI', 'frontend'],
    ['Dashboard', 'frontend'],
    ['CLI', 'frontend'],
    ['Terminal', 'frontend'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 8: Service (9 rules)
  it.each([
    ['PaymentService', 'service'],
    ['PaymentSvc', 'service'],
    ['RestAPI', 'service'],
    ['Lambda', 'service'],
    ['AuthFunction', 'service'],
    ['ValidateFn', 'service'],
    ['CronJob', 'service'],
    ['Cron', 'service'],
    ['Microservice', 'service'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });

  // Group 9: External (5 rules)
  it.each([
    ['External', 'external'],
    ['PaymentExt', 'external'],
    ['ThirdParty', 'external'],
    ['Payment3P', 'external'],
    ['Vendor', 'external'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// New pattern coverage
// ────────────────────────────────────────────────────────────

describe('new patterns — infrastructure overrides (group 1)', () => {
  it.each([
    ['FileWatcher', 'service'],
    ['TaskExecutor', 'service'],
    ['DataAggregator', 'service'],
    ['MetricCollector', 'service'],
    ['DataTransformer', 'service'],
    ['InputValidator', 'service'],
    ['CodeGenerator', 'service'],
    ['SearchIndexer', 'service'],
    ['WebCrawler', 'service'],
    ['PortScanner', 'service'],
    ['JsonParser', 'service'],
    ['EventEmitter', 'service'],
    ['DataExporter', 'service'],
    ['CsvImporter', 'service'],
    ['ConfigLoader', 'service'],
    ['PageRenderer', 'service'],
    ['HealthChecker', 'service'],
    ['CodeInspector', 'service'],
    ['VideoEncoder', 'service'],
    ['AudioDecoder', 'service'],
    ['SlackNotifier', 'service'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — networking (group 2)', () => {
  it.each([
    ['Nginx', 'networking'],
    ['Traefik', 'networking'],
    ['Envoy', 'networking'],
    ['Istio', 'networking'],
    ['Kong', 'networking'],
    ['Akamai', 'networking'],
    ['Cloudflare', 'networking'],
    ['ServiceMesh', 'networking'],
    ['IstioMesh', 'networking'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — database (group 3)', () => {
  it.each([
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
    ['Druid', 'database'],
    ['Trino', 'database'],
    ['Pinecone', 'database'],
    ['Weaviate', 'database'],
    ['Qdrant', 'database'],
    ['Milvus', 'database'],
    ['Presto', 'database'],
    ['OrdersTable', 'database'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — cache (group 4)', () => {
  it.each([
    ['Dragonfly', 'cache'],
    ['Hazelcast', 'cache'],
    ['Valkey', 'cache'],
    ['KeyDB', 'cache'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — queue (group 5)', () => {
  it.each([
    ['NATS', 'queue'],
    ['Pulsar', 'queue'],
    ['Kinesis', 'queue'],
    ['EventBridge', 'queue'],
    ['CloudEvents', 'queue'],
    ['Celery', 'queue'],
    ['Sidekiq', 'queue'],
    ['EventHub', 'queue'],
    ['NotificationChannel', 'queue'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — actor (group 6)', () => {
  it.each([
    ['Fan', 'actor'],
    ['Purchaser', 'actor'],
    ['Reviewer', 'actor'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — frontend (group 7)', () => {
  it.each([
    ['React', 'frontend'],
    ['Vue', 'frontend'],
    ['Angular', 'frontend'],
    ['Svelte', 'frontend'],
    ['NextJS', 'frontend'],
    ['Nuxt', 'frontend'],
    ['Remix', 'frontend'],
    ['Electron', 'frontend'],
    ['Tauri', 'frontend'],
    ['ChatWidget', 'frontend'],
    ['AdminPortal', 'frontend'],
    ['AdminConsole', 'frontend'],
    ['SPA', 'frontend'],
    ['PWA', 'frontend'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — service (group 8)', () => {
  it.each([
    // Auth
    ['Auth', 'service'],
    ['AuthN', 'service'],
    ['AuthZ', 'service'],
    ['SSO', 'service'],
    ['OAuth', 'service'],
    ['OIDC', 'service'],
    // SaaS
    ['Stripe', 'service'],
    ['Twilio', 'service'],
    ['SendGrid', 'service'],
    ['Mailgun', 'service'],
    // Cloud/infra
    ['S3', 'service'],
    ['Blob', 'service'],
    ['Vercel', 'service'],
    ['Netlify', 'service'],
    ['Heroku', 'service'],
    ['Docker', 'service'],
    ['Kubernetes', 'service'],
    ['K8s', 'service'],
    ['Terraform', 'service'],
    // Security
    ['Vault', 'service'],
    ['HSM', 'service'],
    ['KMS', 'service'],
    ['IAM', 'service'],
    // AI/ML
    ['LLM', 'service'],
    ['GPT', 'service'],
    ['Claude', 'service'],
    ['Embedding', 'service'],
    ['Inference', 'service'],
    // Suffixes & patterns
    ['DataPipeline', 'service'],
    ['ContainerRegistry', 'service'],
    ['SearchEngine', 'service'],
    ['Daemon', 'service'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

describe('new patterns — external (group 9)', () => {
  it.each([
    ['Webhook', 'external'],
    ['Callback', 'external'],
    ['Upstream', 'external'],
    ['Downstream', 'external'],
    ['AWS', 'external'],
    ['GCP', 'external'],
    ['Azure', 'external'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Compound name tests
// ────────────────────────────────────────────────────────────

describe('compound names', () => {
  it.each([
    ['PaymentService', 'service'],
    ['UserDB', 'database'],
    ['OrdersTable', 'database'],
    ['ApiGateway', 'networking'],
    ['RedisCache', 'cache'],
    ['TaskQueue', 'queue'],
    ['MobileApp', 'frontend'],
    ['EndUser', 'actor'],
    ['WebhookReceiver', 'external'],
    ['ChatGPT', 'service'],
    ['K8sCluster', 'service'],
    ['StripeAPI', 'service'],
    ['AdminPortal', 'frontend'],
    ['DataPipeline', 'service'],
    ['EventBridge', 'queue'],
    ['NotificationChannel', 'queue'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Priority / override tests
// ────────────────────────────────────────────────────────────

describe('priority and override behavior', () => {
  it('FileWatcher → service (infrastructure override, not actor)', () => {
    expect(inferParticipantType('FileWatcher')).toBe('service');
  });

  it('Reviewer → actor (exact match, not overridden by infra suffixes)', () => {
    expect(inferParticipantType('Reviewer')).toBe('actor');
  });

  it('WebServer → service (Server$ override wins over Web frontend)', () => {
    expect(inferParticipantType('WebServer')).toBe('service');
  });

  it('Webhook → external (conflict override wins over Web frontend)', () => {
    expect(inferParticipantType('Webhook')).toBe('external');
  });

  it('Upstream → external (conflict override wins over Stream$ queue)', () => {
    expect(inferParticipantType('Upstream')).toBe('external');
  });

  it('Downstream → external (conflict override wins over Stream$ queue)', () => {
    expect(inferParticipantType('Downstream')).toBe('external');
  });

  it('KeyDB → cache (conflict override wins over DB$ database)', () => {
    expect(inferParticipantType('KeyDB')).toBe('cache');
  });

  it('MessageBroker → queue (Broker$ in group 1 maps to queue)', () => {
    expect(inferParticipantType('MessageBroker')).toBe('queue');
  });

  it('ServiceMesh → networking (group 2 wins over Service in group 8)', () => {
    expect(inferParticipantType('ServiceMesh')).toBe('networking');
  });

  it('HAProxy → networking (Proxy contains matches in group 2)', () => {
    expect(inferParticipantType('HAProxy')).toBe('networking');
  });

  it('CockroachDB → database (DB$ suffix matches in group 3)', () => {
    expect(inferParticipantType('CockroachDB')).toBe('database');
  });

  it('BullMQ → queue (MQ$ suffix matches in group 5)', () => {
    expect(inferParticipantType('BullMQ')).toBe('queue');
  });

  it('ELB → networking (LB$ suffix matches in group 2)', () => {
    expect(inferParticipantType('ELB')).toBe('networking');
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
    ['nginx', 'networking'],
    ['NGINX', 'networking'],
    ['postgres', 'database'],
    ['POSTGRES', 'database'],
    ['docker', 'service'],
    ['DOCKER', 'service'],
    ['alice', 'actor'],
    ['ALICE', 'actor'],
    ['webhook', 'external'],
    ['WEBHOOK', 'external'],
  ])('%s → %s', (name, expected) => {
    expect(inferParticipantType(name)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────
// Default fallthrough
// ────────────────────────────────────────────────────────────

describe('default fallthrough', () => {
  it.each([
    'Foo',
    'Bar',
    'Payments',
    'Orders',
    'Inventory',
    'Acme',
    'ThingyMajig',
  ])('%s → default', (name) => {
    expect(inferParticipantType(name)).toBe('default');
  });
});
