import { describe, it, expect } from 'vitest';
import { parseC4 } from '../src/c4/parser';

describe('parseC4', () => {
  // === Chart type ===
  describe('chart type', () => {
    it('accepts c4 on first line', () => {
      const result = parseC4('c4\nAlice is a person');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseC4('org\nAlice is a person');
      expect(result.error).toMatch(/Expected chart type "c4"/);
      expect(result.diagnostics[0].severity).toBe('error');
    });

    it('requires explicit c4 header', () => {
      const result = parseC4('Alice is a person');
      expect(result.error).toMatch(/Missing "c4" header/);
    });

    it('handles empty content', () => {
      const result = parseC4('');
      expect(result.error).toMatch(/No content provided/);
    });
  });

  // === Title ===
  describe('title', () => {
    it('parses title from first line', () => {
      const result = parseC4('c4 Banking System\nAlice is a person');
      expect(result.title).toBe('Banking System');
      expect(result.titleLineNumber).toBe(1);
    });

    it('no title returns null', () => {
      const result = parseC4('c4\nAlice is a person');
      expect(result.title).toBeNull();
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseC4('c4\n// a comment\nAlice is a person');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
    });

    it('ignores comments between elements', () => {
      const result = parseC4(
        'c4\nAlice is a person\n// comment\nBanking is a system'
      );
      expect(result.elements).toHaveLength(2);
    });
  });

  // === Element types (is a syntax) ===
  describe('element types', () => {
    it('parses person', () => {
      const result = parseC4('c4\nCustomer is a person');
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('Customer');
      expect(result.elements[0].type).toBe('person');
    });

    it('parses system', () => {
      const result = parseC4('c4\nBanking is a system');
      expect(result.elements[0].type).toBe('system');
    });

    it('parses container', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    API is a container'
      );
      const api = result.elements[0].children[0];
      expect(api.type).toBe('container');
      expect(api.name).toBe('API');
    });

    it('parses component', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    API is a container\n      components\n        Auth is a component'
      );
      const auth = result.elements[0].children[0].children[0];
      expect(auth.type).toBe('component');
      expect(auth.name).toBe('Auth');
    });

    it('is case insensitive for keywords', () => {
      const result = parseC4('c4\nAlice is a Person\nBanking is a SYSTEM');
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].type).toBe('person');
      expect(result.elements[1].type).toBe('system');
    });

    it('parses external as system with external shape', () => {
      const result = parseC4('c4\nStripe is an external');
      expect(result.elements[0].type).toBe('system');
      expect(result.elements[0].shape).toBe('external');
      expect(result.elements[0].name).toBe('Stripe');
    });

    it('parses database as container with database shape', () => {
      const result = parseC4('c4\nPostgreSQL is a database | tech: PostgreSQL');
      expect(result.elements[0].type).toBe('container');
      expect(result.elements[0].shape).toBe('database');
      expect(result.elements[0].name).toBe('PostgreSQL');
      expect(result.elements[0].metadata.tech).toBe('PostgreSQL');
    });

    it('handles "is an" grammar for external', () => {
      const result = parseC4('c4\nAPI Gateway is an external');
      expect(result.elements[0].type).toBe('system');
      expect(result.elements[0].shape).toBe('external');
      expect(result.elements[0].name).toBe('API Gateway');
    });
  });

  // === Shape override ===
  describe('shape override', () => {
    it('parses system with "is a" shape after type', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    UserDB is a container is a database'
      );
      const db = result.elements[0].children[0];
      expect(db.shape).toBe('database');
      expect(db.name).toBe('UserDB');
    });

    it('parses "is a cache" shape via container type', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    SessionStore is a container is a cache'
      );
      expect(result.elements[0].children[0].shape).toBe('cache');
    });

    it('errors on unknown shape', () => {
      const result = parseC4('c4\nFoo is a container is a widget');
      expect(
        result.diagnostics.some((d) => d.message.includes('Unknown shape'))
      ).toBe(true);
    });

    it('strips "is a" shape from element name', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    Cache is a container is a cache | tech: Redis'
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
        'c4\nBanking is a system\n  containers\n    Data is a container | tech: PostgreSQL'
      );
      expect(result.elements[0].children[0].shape).toBe('database');
    });

    it('infers cache from Redis tech', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    Sessions is a container | tech: Redis'
      );
      expect(result.elements[0].children[0].shape).toBe('cache');
    });

    it('infers queue from Kafka tech', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    Events is a container | tech: Kafka'
      );
      expect(result.elements[0].children[0].shape).toBe('queue');
    });

    it('infers database from name containing DB', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    UserDB is a container'
      );
      expect(result.elements[0].children[0].shape).toBe('database');
    });

    it('defaults to default shape when no inference matches', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    API is a container'
      );
      expect(result.elements[0].children[0].shape).toBe('default');
    });
  });

  // === Metadata ===
  describe('metadata', () => {
    it('parses pipe syntax', () => {
      const result = parseC4(
        'c4\nBanking is a system | tech: Node.js, team: Platform'
      );
      expect(result.elements[0].metadata).toEqual({
        tech: 'Node.js',
        team: 'Platform',
      });
    });

    it('parses indented metadata', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  description: Core banking system\n  tech: Java'
      );
      expect(result.elements[0].description).toEqual(['Core banking system']);
      expect(result.elements[0].metadata.tech).toBe('Java');
    });

    it('parses mixed pipe and indented metadata', () => {
      const result = parseC4(
        'c4\nBanking is a system | tech: Java\n  description: Core banking'
      );
      const el = result.elements[0];
      expect(el.metadata.tech).toBe('Java');
      expect(el.description).toEqual(['Core banking']);
    });

    it('resolves tag group aliases in metadata', () => {
      const result = parseC4(
        'c4\ntag Technology tech\n  React blue\n\nBanking is a system | tech: Node.js'
      );
      expect(result.elements[0].metadata.technology).toBe('Node.js');
    });
  });

  // === Node descriptions ===
  describe('node descriptions', () => {
    it('description: text as indented metadata extracts to dedicated description field', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  description: Core banking system'
      );
      expect(result.elements[0].description).toEqual(['Core banking system']);
      expect(result.elements[0].metadata['description']).toBeUndefined();
    });

    it('multiple description lines accumulate', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  description: Handles all banking ops',
          '  description: Built with Java',
        ].join('\n')
      );
      expect(result.elements[0].description).toEqual([
        'Handles all banking ops',
        'Built with Java',
      ]);
    });

    it('pipe metadata: Element | description: text extracts to dedicated field', () => {
      const result = parseC4(
        'c4\nBanking is a system | description: Core banking, tech: Java'
      );
      expect(result.elements[0].description).toEqual(['Core banking']);
      expect(result.elements[0].metadata['description']).toBeUndefined();
      expect(result.elements[0].metadata.tech).toBe('Java');
    });

    it('bare "description" keyword (no colon) still collects but errors (DD-1)', () => {
      const result = parseC4(
        ['c4', 'Banking is a system', '  description Handles all banking'].join(
          '\n'
        )
      );
      // Text is still applied (graceful), but the bare form is rejected at 1.0.
      expect(result.elements[0].description).toEqual(['Handles all banking']);
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === 'E_DESCRIPTION_BARE_REMOVED' && d.severity === 'error'
        )
      ).toBe(true);
    });

    it('keywordless prose under an element is NOT promoted to a description (DD-2)', () => {
      const result = parseC4(
        ['c4', 'Banking is a system', '  Handles all banking ops'].join('\n')
      );
      expect(result.elements[0].description).toBeUndefined();
      expect(
        result.diagnostics.some((d) => d.message.includes('Unexpected content'))
      ).toBe(true);
    });

    it('description does not appear in general metadata record', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  description: Core banking system',
          '  tech: Java',
        ].join('\n')
      );
      expect(result.elements[0].description).toEqual(['Core banking system']);
      expect(result.elements[0].metadata.tech).toBe('Java');
      expect('description' in result.elements[0].metadata).toBe(false);
    });
  });

  // === Relationships ===
  describe('relationships', () => {
    it('parses sync relationship ->', () => {
      const result = parseC4(
        'c4\nCustomer is a person\nBanking is a system\n  -Serves-> Customer'
      );
      const rels = result.elements[1].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0].arrowType).toBe('sync');
      expect(rels[0].target).toBe('Customer');
      expect(rels[0].label).toBe('Serves');
    });

    it('parses async relationship ~>', () => {
      const result = parseC4(
        'c4\nBanking is a system\nEmail is a system\n  ~Sends notifications~> Banking'
      );
      expect(result.elements[1].relationships[0].arrowType).toBe('async');
    });

    it('emits error for deprecated bidirectional <->', () => {
      const result = parseC4('c4\nA is a system\nB is a system\n  <-> A');
      expect(
        result.diagnostics.some(
          (d) => d.severity === 'error' && d.message.includes('<->')
        )
      ).toBe(true);
    });

    it('emits error for deprecated bidirectional async <~>', () => {
      const result = parseC4('c4\nA is a system\nB is a system\n  <~> A');
      expect(
        result.diagnostics.some(
          (d) => d.severity === 'error' && d.message.includes('<~>')
        )
      ).toBe(true);
    });

    it('emits error for deprecated <-label-> syntax', () => {
      const result = parseC4(
        'c4\nA is a system\nB is a system\n  <-Syncs data-> A'
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('Bidirectional arrows are no longer supported')
        )
      ).toBe(true);
    });

    it('colon in plain arrow target is treated as part of target name', () => {
      const result = parseC4('c4\nA is a system\nB is a system\n  -> A: Calls');
      // No label parsing from colon — entire body is the target
      const rel = result.elements[1].relationships[0];
      expect(rel.target).toBe('A: Calls');
      expect(rel.label).toBeUndefined();
    });

    it('parses technology annotation via pipe metadata', () => {
      const result = parseC4(
        'c4\nA is a system\nB is a system\n  -Calls-> A | tech: JSON/HTTPS'
      );
      const rel = result.elements[1].relationships[0];
      expect(rel.technology).toBe('JSON/HTTPS');
      expect(rel.label).toBe('Calls');
    });

    it('parses relationship with target only (no label)', () => {
      const result = parseC4('c4\nA is a system\nB is a system\n  -> A');
      const rel = result.elements[1].relationships[0];
      expect(rel.target).toBe('A');
      expect(rel.label).toBeUndefined();
    });
  });

  // === Section headers ===
  describe('section headers', () => {
    it('parses containers as structural marker', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    API is a container\n    DB is a container'
      );
      expect(result.elements[0].sectionHeader).toBe('containers');
      expect(result.elements[0].children).toHaveLength(2);
    });

    it('parses components inside a container', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          '      components',
          '        Auth is a component',
          '        Accounts is a component',
        ].join('\n')
      );
      const api = result.elements[0].children[0];
      expect(api.sectionHeader).toBe('components');
      expect(api.children).toHaveLength(2);
    });

    it('stores sectionHeaderLineNumber on parent element', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          '      components',
          '        Auth is a component',
        ].join('\n')
      );
      // containers is on line 3
      expect(result.elements[0].sectionHeaderLineNumber).toBe(3);
      // components is on line 5
      const api = result.elements[0].children[0];
      expect(api.sectionHeaderLineNumber).toBe(5);
    });
  });

  // === Groups ===
  describe('groups', () => {
    it('parses [Group Name] with children', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    [Frontend]',
          '      WebApp is a container',
          '      MobileApp is a container',
          '    [Backend]',
          '      API is a container',
        ].join('\n')
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
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          '    DB is a container',
          'deployment',
          '  AWS us-east-1',
          '    ECS Cluster',
          '      container API',
          '    RDS',
          '      container DB',
        ].join('\n')
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
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          'deployment',
          '  AWS us-east-1 | team: Platform',
        ].join('\n')
      );
      expect(result.deployment[0].metadata.team).toBe('Platform');
    });
  });

  // === Imports ===
  describe('imports', () => {
    it('stores import path on element', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          '      import: auth-classes.dgmo',
        ].join('\n')
      );
      expect(result.elements[0].children[0].importPath).toBe(
        'auth-classes.dgmo'
      );
    });
  });

  // === Tag groups ===
  describe('tag groups', () => {
    it('parses tag group definition', () => {
      const result = parseC4(
        [
          'c4',
          'tag Technology tech',
          '  React blue',
          '  Node.js green',
          '',
          'Alice is a person',
        ].join('\n')
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Technology');
      expect(result.tagGroups[0].alias).toBe('tech');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('first entry is default', () => {
      const result = parseC4(
        [
          'c4',
          'tag Team t',
          '  Platform blue',
          '  Payments orange',
          '',
          'Alice is a person',
        ].join('\n')
      );
      expect(result.tagGroups[0].defaultValue).toBe('Platform');
    });

    it('rejects tag groups after content', () => {
      const result = parseC4(
        ['c4', 'Alice is a person', 'tag Team t', '  Platform blue'].join('\n')
      );
      expect(
        result.diagnostics.some((d) => d.message.includes('must appear before'))
      ).toBe(true);
    });

    it('resolves in pipe metadata', () => {
      const result = parseC4(
        [
          'c4',
          'tag Team t',
          '  Platform blue',
          '',
          'Banking is a system | t: Platform',
        ].join('\n')
      );
      // 't' should be resolved to 'team'
      expect(result.elements[0].metadata.team).toBe('Platform');
    });
  });

  // === tag block syntax ===
  describe('tag block syntax', () => {
    it('parses tag heading with entries', () => {
      const result = parseC4(
        [
          'c4',
          'tag Technology tech',
          '  React blue',
          '  Node.js green',
          '',
          'Alice is a person',
        ].join('\n')
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Technology');
      expect(result.tagGroups[0].alias).toBe('tech');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });

    it('first entry becomes default', () => {
      const result = parseC4(
        [
          'c4',
          'tag Team t',
          '  Platform blue',
          '  Payments orange',
          '',
          'Alice is a person',
        ].join('\n')
      );
      expect(result.tagGroups[0].defaultValue).toBe('Platform');
    });

    it('is case-insensitive', () => {
      const result = parseC4(
        ['c4', 'Tag Team', '  Platform blue', '', 'Alice is a person'].join(
          '\n'
        )
      );
      expect(result.tagGroups[0].name).toBe('Team');
    });

    it('does not emit deprecation warning for tag syntax', () => {
      const result = parseC4(
        ['c4', 'tag Team', '  Platform blue', '', 'Alice is a person'].join(
          '\n'
        )
      );
      const warnings = result.diagnostics.filter((d) =>
        d.message.includes('deprecated')
      );
      expect(warnings).toHaveLength(0);
    });

    it('ignores ## syntax (no longer recognized as tag heading)', () => {
      const result = parseC4(
        ['c4', '## Team', '  Platform blue', '', 'Alice is a person'].join('\n')
      );
      expect(result.tagGroups).toHaveLength(0);
    });

    it('resolves in pipe metadata with tag syntax', () => {
      const result = parseC4(
        [
          'c4',
          'tag Team t',
          '  Platform blue',
          '',
          'Banking is a system | t: Platform',
        ].join('\n')
      );
      expect(result.elements[0].metadata.team).toBe('Platform');
    });
  });

  // === Nesting ===
  describe('nesting', () => {
    it('builds system > container > component hierarchy', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container',
          '      components',
          '        Auth is a component',
          '        Payments is a component',
          '    DB is a container is a database',
        ].join('\n')
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
          'c4',
          'Customer is a person',
          'Banking is a system',
          'Email is a system',
        ].join('\n')
      );
      expect(result.elements).toHaveLength(3);
    });
  });

  // === Line numbers ===
  describe('line numbers', () => {
    it('tracks line numbers on elements', () => {
      const result = parseC4('c4\nAlice is a person\nBanking is a system');
      expect(result.elements[0].lineNumber).toBe(2);
      expect(result.elements[1].lineNumber).toBe(3);
    });

    it('tracks line numbers on relationships', () => {
      const result = parseC4('c4\nA is a system\n  -calls-> B');
      expect(result.elements[0].relationships[0].lineNumber).toBe(3);
    });

    it('tracks line numbers on tag groups', () => {
      const result = parseC4(
        'c4\ntag Team\n  Platform blue\n\nAlice is a person'
      );
      expect(result.tagGroups[0].lineNumber).toBe(2);
      expect(result.tagGroups[0].entries[0].lineNumber).toBe(3);
    });
  });

  // === Errors ===
  describe('errors', () => {
    it('reports duplicate element names', () => {
      const result = parseC4('c4\nBanking is a system\nBanking is a system');
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Duplicate element name')
        )
      ).toBe(true);
    });

    it('reports unknown element keywords with suggestion', () => {
      const result = parseC4('c4\nsytem Banking');
      expect(
        result.diagnostics.some((d) => d.message.includes('Did you mean'))
      ).toBe(true);
    });

    it('warns about unresolved relationship targets', () => {
      const result = parseC4('c4\nBanking is a system\n  -calls-> NonExistent');
      const warning = result.diagnostics.find((d) =>
        d.message.includes('not found')
      );
      expect(warning).toBeDefined();
      expect(warning!.severity).toBe('warning');
    });

    it('warns about unresolved deployment container refs', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          'deployment',
          '  AWS',
          '    container NonExistent',
        ].join('\n')
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Deployment reference')
        )
      ).toBe(true);
    });
  });

  // === Options ===
  describe('options', () => {
    it('parses header options', () => {
      const result = parseC4('c4\nlayout left-right\nAlice is a person');
      expect(result.options.layout).toBe('left-right');
    });
  });

  // === Comprehensive ===
  describe('comprehensive', () => {
    it('parses the full epic spec example', () => {
      const input = [
        'c4 Internet Banking System',
        '',
        'tag Technology tech',
        '  React blue',
        '  Node.js green',
        '  PostgreSQL purple',
        '  Redis red',
        '',
        'tag Team t',
        '  Platform blue',
        '  Payments orange',
        '',
        'tag Scope sc',
        '  Internal blue',
        '  External gray',
        '',
        'Customer is a person',
        '  description: A customer of the bank',
        '  -Views accounts, makes payments-> Internet Banking',
        '',
        'Internet Banking is a system',
        '  description: Allows customers to view accounts and make payments',
        '',
        '  containers',
        '    [Frontend]',
        '      Web App is a container | tech: React, t: Platform',
        '        description: Delivers the SPA',
        '        -Makes calls to-> API | tech: JSON/HTTPS',
        '',
        '      Mobile App is a container | tech: React Native, t: Platform',
        '        description: iOS and Android client',
        '        -Makes calls to-> API | tech: JSON/HTTPS',
        '',
        '    [Backend]',
        '      API is a container | tech: Node.js, t: Platform',
        '        description: JSON/HTTPS API',
        '        -Reads/writes-> Database | tech: SQL/TCP',
        '        -Reads/writes-> Cache | tech: TCP',
        '        ~Sends notifications~> Email System | tech: SMTP',
        '        -Gets account info-> Mainframe | tech: XML/HTTPS',
        '',
        '        components',
        '          Auth Controller is a component | tech: Express',
        '            description: Handles authentication',
        '            import: auth-classes.dgmo',
        '            -Reads users-> User Repository',
        '',
        '          Accounts Controller is a component | tech: Express',
        '            description: Provides account information',
        '            -Reads accounts-> Accounts Repository',
        '',
        '      Worker is a container | tech: Node.js, t: Payments',
        '        description: Async job processor',
        '        ~Consumes events~> Event Bus | tech: AMQP',
        '',
        '    Database is a container | tech: PostgreSQL, t: Payments',
        '      description: Account data store',
        '',
        '    Cache is a container is a cache | tech: Redis, t: Platform',
        '      description: Session and rate-limit cache',
        '',
        '    Event Bus is a container | tech: RabbitMQ, t: Platform',
        '      description: Async event backbone',
        '',
        'Email System is a system | sc: External',
        '  description: Sendgrid email service',
        '  -Sends emails to-> Customer',
        '',
        'Mainframe is a system | sc: External',
        '  description: Core banking system',
        '',
        'deployment',
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
        'Internet Banking'
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
      const api = banking.groups[1].children.find((c) => c.name === 'API');
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
        'Web App'
      );
      expect(result.deployment[1].name).toBe('Cloudflare');
    });
  });

  // ============================================================
  // Labeled arrow syntax: -label->, ~label~>, <-label->, <~label~>
  // ============================================================
  describe('labeled arrow syntax', () => {
    it('-label-> produces sync relationship', () => {
      const result = parseC4(`c4
API is a system
  -Makes calls-> Backend`);
      expect(result.error).toBeNull();
      const rels = result.elements[0].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        target: 'Backend',
        label: 'Makes calls',
        arrowType: 'sync',
      });
    });

    it('~label~> produces async relationship', () => {
      const result = parseC4(`c4
API is a system
  ~Sends events~> Queue`);
      expect(result.error).toBeNull();
      const rels = result.elements[0].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        target: 'Queue',
        label: 'Sends events',
        arrowType: 'async',
      });
    });

    it('<-label-> emits deprecation error with replacement hint', () => {
      const result = parseC4(`c4
API is a system
  <-Syncs data-> Database`);
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('Bidirectional arrows are no longer supported')
        )
      ).toBe(true);
    });

    it('<~label~> emits deprecation error with replacement hint', () => {
      const result = parseC4(`c4
API is a system
  <~heartbeat~> Monitor`);
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'error' &&
            d.message.includes('Bidirectional arrows are no longer supported')
        )
      ).toBe(true);
    });

    it('TD-5: trailing [tech] sugar is no longer extracted — label keeps brackets', () => {
      // Per the "In-Arrow Message Labels" spec, trailing [technology] is not
      // parsed out of the in-arrow label. Use the post-colon / pipe metadata
      // form for technology annotations.
      const result = parseC4(`c4
WebApp is a system
  -Makes calls [JSON/HTTPS]-> API`);
      expect(result.error).toBeNull();
      const rels = result.elements[0].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        target: 'API',
        label: 'Makes calls [JSON/HTTPS]',
        arrowType: 'sync',
      });
      expect(rels[0]?.technology).toBeUndefined();
    });

    it('TD-5: technology metadata via pipe on target works', () => {
      const result = parseC4(`c4
WebApp is a system
  -Makes calls-> API | tech: JSON/HTTPS`);
      expect(result.error).toBeNull();
      const rels = result.elements[0].relationships;
      expect(rels).toHaveLength(1);
      expect(rels[0]).toMatchObject({
        target: 'API',
        label: 'Makes calls',
        technology: 'JSON/HTTPS',
        arrowType: 'sync',
      });
    });

    it('labeled and bare arrows coexist in same diagram', () => {
      const result = parseC4(`c4
API is a system
  -Calls-> Backend
  -> Database`);
      expect(result.error).toBeNull();
      const rels = result.elements[0].relationships;
      expect(rels).toHaveLength(2);
      expect(rels[0]).toMatchObject({ label: 'Calls', arrowType: 'sync' });
      expect(rels[1]).toMatchObject({ target: 'Database', arrowType: 'sync' });
    });
  });

  // ============================================================
  // Deprecated prefix syntax
  // ============================================================
  describe('deprecated prefix syntax', () => {
    it('person Name emits deprecation error', () => {
      const result = parseC4('c4\nperson Auth Service');
      expect(
        result.diagnostics.some(
          (d) =>
            d.message.includes(
              "'person Auth Service' prefix syntax is no longer supported"
            ) && d.message.includes("'Auth Service is a person' instead")
        )
      ).toBe(true);
      // Still parses the element (graceful degradation)
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('Auth Service');
      expect(result.elements[0].type).toBe('person');
    });

    it('system Name emits deprecation error', () => {
      const result = parseC4('c4\nsystem Database');
      expect(
        result.diagnostics.some(
          (d) =>
            d.message.includes('prefix syntax is no longer supported') &&
            d.message.includes("'Database is a system' instead")
        )
      ).toBe(true);
      expect(result.elements).toHaveLength(1);
    });

    it('container Name emits deprecation error', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    container API'
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.message.includes(
              "'container API' prefix syntax is no longer supported"
            ) && d.message.includes("'API is a container' instead")
        )
      ).toBe(true);
    });

    it('component Name emits deprecation error', () => {
      const result = parseC4(
        'c4\nBanking is a system\n  containers\n    API is a container\n      components\n        component Auth'
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.message.includes(
              "'component Auth' prefix syntax is no longer supported"
            ) && d.message.includes("'Auth is a component' instead")
        )
      ).toBe(true);
    });
  });

  // ============================================================
  // "Name is a type" declaration syntax
  // ============================================================
  describe('"Name is a type" declarations', () => {
    it('Auth Service is a system', () => {
      const result = parseC4('c4\nAuth Service is a system');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('Auth Service');
      expect(result.elements[0].type).toBe('system');
    });

    it('PostgreSQL is a database with pipe metadata', () => {
      const result = parseC4('c4\nPostgreSQL is a database | tech: PostgreSQL');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('PostgreSQL');
      expect(result.elements[0].type).toBe('container');
      expect(result.elements[0].shape).toBe('database');
      expect(result.elements[0].metadata.tech).toBe('PostgreSQL');
    });

    it('API Gateway is an external (grammar forgiveness)', () => {
      const result = parseC4('c4\nAPI Gateway is an external');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('API Gateway');
      expect(result.elements[0].type).toBe('system');
      expect(result.elements[0].shape).toBe('external');
    });

    it('MyApp is a system is a cylinder reports unknown shape', () => {
      const result = parseC4('c4\nMyApp is a system is a cylinder');
      // 'cylinder' is not a valid shape, should report error
      expect(
        result.diagnostics.some((d) =>
          d.message.includes('Unknown shape "cylinder"')
        )
      ).toBe(true);
      // Element still created
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('MyApp');
      expect(result.elements[0].type).toBe('system');
    });

    it('accepts "is a" and "is an" identically (grammar forgiveness)', () => {
      const r1 = parseC4('c4\nGateway is a system');
      const r2 = parseC4('c4\nGateway is an system');
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      expect(r1.elements[0].type).toBe('system');
      expect(r2.elements[0].type).toBe('system');
    });

    it('MyApp is a system is a cache applies shape override', () => {
      const result = parseC4('c4\nMyApp is a system is a cache');
      expect(result.error).toBeNull();
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].name).toBe('MyApp');
      expect(result.elements[0].type).toBe('system');
      expect(result.elements[0].shape).toBe('cache');
    });

    it('works with indented metadata', () => {
      const result = parseC4(
        'c4\nAuth Service is a system\n  description: Handles auth\n  tech: Node.js'
      );
      expect(result.error).toBeNull();
      expect(result.elements[0].description).toEqual(['Handles auth']);
      expect(result.elements[0].metadata.tech).toBe('Node.js');
    });

    it('works with relationships', () => {
      const result = parseC4(
        'c4\nAlice is a person\nBanking is a system\n  -Serves-> Alice'
      );
      expect(result.error).toBeNull();
      expect(result.elements[1].relationships).toHaveLength(1);
      expect(result.elements[1].relationships[0].target).toBe('Alice');
    });

    it('works nested under containers', () => {
      const result = parseC4(
        [
          'c4',
          'Banking is a system',
          '  containers',
          '    API is a container | tech: Node.js',
          '    Cache is a container is a cache | tech: Redis',
        ].join('\n')
      );
      expect(result.error).toBeNull();
      expect(result.elements[0].children).toHaveLength(2);
      expect(result.elements[0].children[0].name).toBe('API');
      expect(result.elements[0].children[0].metadata.tech).toBe('Node.js');
      expect(result.elements[0].children[1].name).toBe('Cache');
      expect(result.elements[0].children[1].shape).toBe('cache');
    });
  });

  describe('universal alias syntax (TD-18)', () => {
    it('extracts alias from `Name is a TYPE as <alias>`', () => {
      const result = parseC4(`c4
OrderSystem is a system as os
Alice is a person as al
  -uses-> os`);
      expect(
        result.diagnostics.filter((d) => d.severity === 'error')
      ).toHaveLength(0);
      expect(result.elements.map((e) => e.name).sort()).toEqual([
        'Alice',
        'OrderSystem',
      ]);
      const rel = result.elements.find((e) => e.name === 'Alice')
        ?.relationships[0];
      expect(rel?.target).toBe('OrderSystem');
    });

    it('alias does not survive across separate parse calls', () => {
      const a = parseC4(`c4
OrderSystem is a system as os`);
      expect(a.elements[0].name).toBe('OrderSystem');
      const b = parseC4(`c4
Alice is a person
  -uses-> os`);
      // `os` isn't declared in `b`; resolves to itself.
      expect(b.elements[0].relationships[0].target).toBe('os');
    });
  });
});
