import { describe, it, expect } from 'vitest';
import { parseC4 } from '../src/c4/parser';

describe('parseC4', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts chart: c4', () => {
      const result = parseC4('chart: c4\nperson Alice');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseC4('chart: org\nperson Alice');
      expect(result.error).toMatch(/Expected chart type "c4"/);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('requires explicit chart: c4 header', () => {
      const result = parseC4('person Alice');
      expect(result.error).toMatch(/Missing "chart: c4" header/);
    });

    it('handles empty content', () => {
      const result = parseC4('');
      expect(result.error).toMatch(/No content provided/);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title', () => {
      const result = parseC4('chart: c4\ntitle: Banking System\nperson Alice');
      expect(result.title).toBe('Banking System');
      expect(result.titleLineNumber).toBe(2);
    });

    it('no title returns null', () => {
      const result = parseC4('chart: c4\nperson Alice');
      expect(result.title).toBeNull();
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseC4('chart: c4\n// a comment\nperson Alice');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
    });

    it('ignores comments between elements', () => {
      const result = parseC4(
        'chart: c4\nperson Alice\n// comment\nsystem Banking',
      );
      expect(result.elements).toHaveLength(2);
    });
  });

  // === Element types ===
  describe('element types', () => {
    it('parses person', () => {
      const result = parseC4('chart: c4\nperson Customer');
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('Customer');
      expect(result.elements[0].type).toBe('person');
    });

    it('parses system', () => {
      const result = parseC4('chart: c4\nsystem Banking');
      expect(result.elements[0].type).toBe('system');
    });

    it('parses container', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container API',
      );
      const api = result.elements[0].children[0];
      expect(api.type).toBe('container');
      expect(api.name).toBe('API');
    });

    it('parses component', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container API\n      components:\n        component Auth',
      );
      const auth = result.elements[0].children[0].children[0];
      expect(auth.type).toBe('component');
      expect(auth.name).toBe('Auth');
    });

    it('is case insensitive for keywords', () => {
      const result = parseC4('chart: c4\nPerson Alice\nSYSTEM Banking');
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].type).toBe('person');
      expect(result.elements[1].type).toBe('system');
    });
  });

  // === Shape override ===
  describe('shape override', () => {
    it('parses "is a database"', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container UserDB is a database',
      );
      const db = result.elements[0].children[0];
      expect(db.shape).toBe('database');
      expect(db.name).toBe('UserDB');
    });

    it('parses "is a cache"', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container SessionStore is a cache',
      );
      expect(result.elements[0].children[0].shape).toBe('cache');
    });

    it('parses "is an external"', () => {
      const result = parseC4(
        'chart: c4\nsystem Stripe is an external',
      );
      expect(result.elements[0].shape).toBe('external');
    });

    it('errors on unknown shape', () => {
      const result = parseC4(
        'chart: c4\ncontainer Foo is a widget',
      );
      expect(result.diagnostics.some((d) => d.message.includes('Unknown shape'))).toBe(
        true,
      );
    });

    it('strips "is a" from element name', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container Cache is a cache | tech: Redis',
      );
      const el = result.elements[0].children[0];
      expect(el.name).toBe('Cache');
      expect(el.shape).toBe('cache');
      expect(el.metadata.tech).toBe('Redis');
    });
  });

  // === Shape inference ===
  describe('shape inference', () => {
    it('infers database from PostgreSQL tech', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container Data | tech: PostgreSQL',
      );
      expect(result.elements[0].children[0].shape).toBe('database');
    });

    it('infers cache from Redis tech', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container Sessions | tech: Redis',
      );
      expect(result.elements[0].children[0].shape).toBe('cache');
    });

    it('infers queue from Kafka tech', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container Events | tech: Kafka',
      );
      expect(result.elements[0].children[0].shape).toBe('queue');
    });

    it('infers database from name containing DB', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container UserDB',
      );
      expect(result.elements[0].children[0].shape).toBe('database');
    });

    it('defaults to default shape when no inference matches', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container API',
      );
      expect(result.elements[0].children[0].shape).toBe('default');
    });
  });

  // === Metadata ===
  describe('metadata', () => {
    it('parses pipe syntax', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking | tech: Node.js, team: Platform',
      );
      expect(result.elements[0].metadata).toEqual({
        tech: 'Node.js',
        team: 'Platform',
      });
    });

    it('parses indented metadata', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  description: Core banking system\n  tech: Java',
      );
      expect(result.elements[0].metadata.description).toBe(
        'Core banking system',
      );
      expect(result.elements[0].metadata.tech).toBe('Java');
    });

    it('parses mixed pipe and indented metadata', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking | tech: Java\n  description: Core banking',
      );
      const el = result.elements[0];
      expect(el.metadata.tech).toBe('Java');
      expect(el.metadata.description).toBe('Core banking');
    });

    it('resolves tag group aliases in metadata', () => {
      const result = parseC4(
        'chart: c4\n## Technology alias tech\n  React(blue)\n\nsystem Banking | tech: Node.js',
      );
      expect(result.elements[0].metadata.technology).toBe('Node.js');
    });
  });

  // === Relationships ===
  describe('relationships', () => {
    it('parses sync relationship ->', () => {
      const result = parseC4(
        'chart: c4\nperson Customer\nsystem Banking\n  -> Customer: Serves',
      );
      const rels = result.elements[1].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0].arrowType).toBe('sync');
      expect(rels[0].target).toBe('Customer');
      expect(rels[0].label).toBe('Serves');
    });

    it('parses async relationship ~>', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\nsystem Email\n  ~> Banking: Sends notifications',
      );
      expect(result.elements[1].relationships[0].arrowType).toBe('async');
    });

    it('parses bidirectional <->', () => {
      const result = parseC4(
        'chart: c4\nsystem A\nsystem B\n  <-> A: Syncs data',
      );
      expect(result.elements[1].relationships[0].arrowType).toBe(
        'bidirectional',
      );
    });

    it('parses bidirectional async <~>', () => {
      const result = parseC4(
        'chart: c4\nsystem A\nsystem B\n  <~> A: Events',
      );
      expect(result.elements[1].relationships[0].arrowType).toBe(
        'bidirectional-async',
      );
    });

    it('parses technology annotation [tech]', () => {
      const result = parseC4(
        'chart: c4\nsystem A\nsystem B\n  -> A: Calls [JSON/HTTPS]',
      );
      const rel = result.elements[1].relationships[0];
      expect(rel.technology).toBe('JSON/HTTPS');
      expect(rel.label).toBe('Calls');
    });

    it('parses relationship with target only (no label)', () => {
      const result = parseC4(
        'chart: c4\nsystem A\nsystem B\n  -> A',
      );
      const rel = result.elements[1].relationships[0];
      expect(rel.target).toBe('A');
      expect(rel.label).toBeUndefined();
    });
  });

  // === Section headers ===
  describe('section headers', () => {
    it('parses containers: as structural marker', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  containers:\n    container API\n    container DB',
      );
      expect(result.elements[0].sectionHeader).toBe('containers');
      expect(result.elements[0].children).toHaveLength(2);
    });

    it('parses components: inside a container', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          '      components:',
          '        component Auth',
          '        component Accounts',
        ].join('\n'),
      );
      const api = result.elements[0].children[0];
      expect(api.sectionHeader).toBe('components');
      expect(api.children).toHaveLength(2);
    });

    it('stores sectionHeaderLineNumber on parent element', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          '      components:',
          '        component Auth',
        ].join('\n'),
      );
      // containers: is on line 3
      expect(result.elements[0].sectionHeaderLineNumber).toBe(3);
      // components: is on line 5
      const api = result.elements[0].children[0];
      expect(api.sectionHeaderLineNumber).toBe(5);
    });
  });

  // === Groups ===
  describe('groups', () => {
    it('parses [Group Name] with children', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    [Frontend]',
          '      container WebApp',
          '      container MobileApp',
          '    [Backend]',
          '      container API',
        ].join('\n'),
      );
      const banking = result.elements[0];
      expect(banking.groups).toHaveLength(2);
      expect(banking.groups[0].name).toBe('Frontend');
      expect(banking.groups[0].children).toHaveLength(2);
      expect(banking.groups[1].name).toBe('Backend');
      expect(banking.groups[1].children).toHaveLength(1);
    });
  });

  // === Deployment ===
  describe('deployment', () => {
    it('parses deployment section', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          '    container DB',
          'deployment:',
          '  AWS us-east-1',
          '    ECS Cluster',
          '      container API',
          '    RDS',
          '      container DB',
        ].join('\n'),
      );
      expect(result.deployment).toHaveLength(1);
      expect(result.deployment[0].name).toBe('AWS us-east-1');
      expect(result.deployment[0].children).toHaveLength(2);
      expect(result.deployment[0].children[0].name).toBe('ECS Cluster');
      expect(result.deployment[0].children[0].containerRefs).toEqual(['API']);
      expect(result.deployment[0].children[1].name).toBe('RDS');
      expect(result.deployment[0].children[1].containerRefs).toEqual(['DB']);
    });

    it('parses deployment node metadata', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          'deployment:',
          '  AWS us-east-1 | team: Platform',
        ].join('\n'),
      );
      expect(result.deployment[0].metadata.team).toBe('Platform');
    });
  });

  // === Imports ===
  describe('imports', () => {
    it('stores import path on element', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          '      import: auth-classes.dgmo',
        ].join('\n'),
      );
      expect(result.elements[0].children[0].importPath).toBe(
        'auth-classes.dgmo',
      );
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag group definition', () => {
      const result = parseC4(
        [
          'chart: c4',
          '## Technology alias tech',
          '  React(blue)',
          '  Node.js(green)',
          '',
          'person Alice',
        ].join('\n'),
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Technology');
      expect(result.tagGroups[0].alias).toBe('tech');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('parses default entry', () => {
      const result = parseC4(
        [
          'chart: c4',
          '## Team alias t',
          '  Platform(blue) default',
          '  Payments(orange)',
          '',
          'person Alice',
        ].join('\n'),
      );
      expect(result.tagGroups[0].defaultValue).toBe('Platform');
    });

    it('rejects tag groups after content', () => {
      const result = parseC4(
        [
          'chart: c4',
          'person Alice',
          '## Team alias t',
          '  Platform(blue)',
        ].join('\n'),
      );
      expect(result.diagnostics.some((d) => d.message.includes('must appear before'))).toBe(true);
    });

    it('resolves alias in pipe metadata', () => {
      const result = parseC4(
        [
          'chart: c4',
          '## Team alias t',
          '  Platform(blue)',
          '',
          'system Banking | t: Platform',
        ].join('\n'),
      );
      // 't' should be resolved to 'team'
      expect(result.elements[0].metadata.team).toBe('Platform');
    });
  });

  // === Nesting ===
  describe('nesting', () => {
    it('builds system > container > component hierarchy', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          '  containers:',
          '    container API',
          '      components:',
          '        component Auth',
          '        component Payments',
          '    container DB is a database',
        ].join('\n'),
      );
      expect(result.elements).toHaveLength(1);
      const banking = result.elements[0];
      expect(banking.children).toHaveLength(2);
      expect(banking.children[0].name).toBe('API');
      expect(banking.children[0].children).toHaveLength(2);
      expect(banking.children[1].name).toBe('DB');
      expect(banking.children[1].shape).toBe('database');
    });

    it('multiple top-level elements', () => {
      const result = parseC4(
        [
          'chart: c4',
          'person Customer',
          'system Banking',
          'system Email',
        ].join('\n'),
      );
      expect(result.elements).toHaveLength(3);
    });
  });

  // === Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on elements', () => {
      const result = parseC4(
        'chart: c4\nperson Alice\nsystem Banking',
      );
      expect(result.elements[0].lineNumber).toBe(2);
      expect(result.elements[1].lineNumber).toBe(3);
    });

    it('tracks line numbers on relationships', () => {
      const result = parseC4(
        'chart: c4\nsystem A\n  -> B: calls',
      );
      expect(result.elements[0].relationships[0].lineNumber).toBe(3);
    });

    it('tracks line numbers on tag groups', () => {
      const result = parseC4(
        'chart: c4\n## Team\n  Platform(blue)\n\nperson Alice',
      );
      expect(result.tagGroups[0].lineNumber).toBe(2);
      expect(result.tagGroups[0].entries[0].lineNumber).toBe(3);
    });
  });

  // === Errors ===
  describe('errors', () => {
    it('reports duplicate element names', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\nsystem Banking',
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('Duplicate element name')),
      ).toBe(true);
    });

    it('reports unknown element keywords with suggestion', () => {
      const result = parseC4('chart: c4\nsytem Banking');
      expect(
        result.diagnostics.some((d) => d.message.includes('Did you mean')),
      ).toBe(true);
    });

    it('warns about unresolved relationship targets', () => {
      const result = parseC4(
        'chart: c4\nsystem Banking\n  -> NonExistent: calls',
      );
      const warning = result.diagnostics.find((d) =>
        d.message.includes('not found'),
      );
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
    });

    it('warns about unresolved deployment container refs', () => {
      const result = parseC4(
        [
          'chart: c4',
          'system Banking',
          'deployment:',
          '  AWS',
          '    container NonExistent',
        ].join('\n'),
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Deployment reference'),
        ),
      ).toBe(true);
    });
  });

  // === Options ===
  describe('options', () => {
    it('parses header options', () => {
      const result = parseC4(
        'chart: c4\nlayout: left-right\nperson Alice',
      );
      expect(result.options.layout).toBe('left-right');
    });
  });

  // === Comprehensive ===
  describe('comprehensive', () => {
    it('parses the full epic spec example', () => {
      const input = [
        'chart: c4',
        'title: Internet Banking System',
        '',
        '## Technology alias tech',
        '  React(blue)',
        '  Node.js(green)',
        '  PostgreSQL(purple)',
        '  Redis(red)',
        '',
        '## Team alias t',
        '  Platform(blue) default',
        '  Payments(orange)',
        '',
        '## Scope alias sc',
        '  Internal(blue) default',
        '  External(gray)',
        '',
        'person Customer',
        '  description: A customer of the bank',
        '  -> Internet Banking: Views accounts, makes payments',
        '',
        'system Internet Banking',
        '  description: Allows customers to view accounts and make payments',
        '',
        '  containers:',
        '    [Frontend]',
        '      container Web App | tech: React, t: Platform',
        '        description: Delivers the SPA',
        '        -> API: Makes calls to [JSON/HTTPS]',
        '',
        '      container Mobile App | tech: React Native, t: Platform',
        '        description: iOS and Android client',
        '        -> API: Makes calls to [JSON/HTTPS]',
        '',
        '    [Backend]',
        '      container API | tech: Node.js, t: Platform',
        '        description: JSON/HTTPS API',
        '        -> Database: Reads/writes [SQL/TCP]',
        '        -> Cache: Reads/writes [TCP]',
        '        ~> Email System: Sends notifications [SMTP]',
        '        -> Mainframe: Gets account info [XML/HTTPS]',
        '',
        '        components:',
        '          component Auth Controller | tech: Express',
        '            description: Handles authentication',
        '            import: auth-classes.dgmo',
        '            -> User Repository: Reads users',
        '',
        '          component Accounts Controller | tech: Express',
        '            description: Provides account information',
        '            -> Accounts Repository: Reads accounts',
        '',
        '      container Worker | tech: Node.js, t: Payments',
        '        description: Async job processor',
        '        ~> Event Bus: Consumes events [AMQP]',
        '',
        '    container Database | tech: PostgreSQL, t: Payments',
        '      description: Account data store',
        '',
        '    container Cache is a cache | tech: Redis, t: Platform',
        '      description: Session and rate-limit cache',
        '',
        '    container Event Bus | tech: RabbitMQ, t: Platform',
        '      description: Async event backbone',
        '',
        'system Email System | sc: External',
        '  description: Sendgrid email service',
        '  -> Customer: Sends emails to',
        '',
        'system Mainframe | sc: External',
        '  description: Core banking system',
        '',
        'deployment:',
        '  AWS us-east-1 | t: Platform',
        '    ECS Cluster',
        '      container Web App',
        '      container API',
        '      container Worker',
        '    RDS',
        '      container Database',
        '    ElastiCache',
        '      container Cache',
        '    Amazon MQ',
        '      container Event Bus',
        '  Cloudflare | sc: External',
        '    CDN',
        '      container Mobile App',
      ].join('\n');

      const result = parseC4(input);

      // No fatal errors
      expect(result.error).toBeNull();

      // Title
      expect(result.title).toBe('Internet Banking System');

      // Tag groups
      expect(result.tagGroups).toHaveLength(3);
      expect(result.tagGroups[0].name).toBe('Technology');
      expect(result.tagGroups[0].alias).toBe('tech');
      expect(result.tagGroups[1].name).toBe('Team');
      expect(result.tagGroups[1].defaultValue).toBe('Platform');
      expect(result.tagGroups[2].name).toBe('Scope');

      // Top-level elements: Customer, Internet Banking, Email System, Mainframe
      expect(result.elements).toHaveLength(4);
      expect(result.elements[0].name).toBe('Customer');
      expect(result.elements[0].type).toBe('person');
      expect(result.elements[1].name).toBe('Internet Banking');
      expect(result.elements[1].type).toBe('system');
      expect(result.elements[2].name).toBe('Email System');
      expect(result.elements[3].name).toBe('Mainframe');

      // Customer relationships
      expect(result.elements[0].relationships).toHaveLength(1);
      expect(result.elements[0].relationships[0].target).toBe(
        'Internet Banking',
      );

      // Internet Banking structure
      const banking = result.elements[1];
      expect(banking.sectionHeader).toBe('containers');
      expect(banking.groups).toHaveLength(2);
      expect(banking.groups[0].name).toBe('Frontend');
      expect(banking.groups[0].children).toHaveLength(2);
      expect(banking.groups[1].name).toBe('Backend');

      // Cache shape override
      const containers = [
        ...banking.groups[0].children,
        ...banking.groups[1].children,
        ...banking.children,
      ];
      const cache = containers.find((c) => c.name === 'Cache');
      expect(cache).toBeDefined();
      expect(cache!.shape).toBe('cache');

      // API components
      const api = banking.groups[1].children.find(
        (c) => c.name === 'API',
      );
      expect(api).toBeDefined();
      expect(api!.sectionHeader).toBe('components');
      expect(api!.children).toHaveLength(2);
      expect(api!.children[0].name).toBe('Auth Controller');
      expect(api!.children[0].importPath).toBe('auth-classes.dgmo');

      // API relationships
      expect(api!.relationships.length).toBeGreaterThanOrEqual(4);

      // Deployment
      expect(result.deployment).toHaveLength(2);
      expect(result.deployment[0].name).toBe('AWS us-east-1');
      expect(result.deployment[0].children).toHaveLength(4);
      expect(result.deployment[0].children[0].containerRefs).toContain(
        'Web App',
      );
      expect(result.deployment[1].name).toBe('Cloudflare');
    });
  });
});
