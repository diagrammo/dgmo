import { describe, it, expect } from 'vitest';
import { parseClassDiagram, looksLikeClassDiagram } from '../src/class/parser';

describe('parseClassDiagram', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses chart: class', () => {
      const result = parseClassDiagram('chart: class\nAnimal\n  name: string');
      expect(result.type).toBe('class');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('rejects wrong chart type', () => {
      const result = parseClassDiagram('chart: flowchart\nAnimal\n  name: string');
      expect(result.error).toContain('Expected chart type "class"');
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toMatch(/Expected chart type "class"/);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('parses title', () => {
      const result = parseClassDiagram('chart: class\ntitle: My Classes\nAnimal\n  name: string');
      expect(result.title).toBe('My Classes');
      expect(result.titleLineNumber).toBe(2);
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseClassDiagram('// this is a comment\nAnimal\n  name: string');
      expect(result.error).toBeNull();
      expect(result.classes).toHaveLength(1);
    });
  });

  // === Class declarations ===
  describe('class declarations', () => {
    it('parses simple class', () => {
      const result = parseClassDiagram('Animal\n  name: string');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].name).toBe('Animal');
      expect(result.classes[0].modifier).toBeUndefined();
    });

    it('parses abstract class', () => {
      const result = parseClassDiagram('Animal [abstract]\n  name: string');
      expect(result.classes[0].modifier).toBe('abstract');
    });

    it('parses interface', () => {
      const result = parseClassDiagram('Drawable [interface]\n  draw(): void');
      expect(result.classes[0].modifier).toBe('interface');
    });

    it('parses enum', () => {
      const result = parseClassDiagram('Color [enum]\n  Red\n  Green\n  Blue');
      expect(result.classes[0].modifier).toBe('enum');
      expect(result.classes[0].members).toHaveLength(3);
    });

    it('parses class with color', () => {
      const result = parseClassDiagram('Animal (red)\n  name: string');
      expect(result.classes[0].color).toBeDefined();
    });

    it('parses class with modifier and color', () => {
      const result = parseClassDiagram('Animal [abstract] (blue)\n  name: string');
      expect(result.classes[0].modifier).toBe('abstract');
      expect(result.classes[0].color).toBeDefined();
    });

    it('tracks line numbers', () => {
      const result = parseClassDiagram('chart: class\ntitle: Test\n\nAnimal\n  name: string');
      expect(result.classes[0].lineNumber).toBe(4);
    });

    it('handles empty class (no members)', () => {
      const result = parseClassDiagram('Animal');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].members).toHaveLength(0);
    });
  });

  // === Fields ===
  describe('fields', () => {
    it('parses public field (default)', () => {
      const result = parseClassDiagram('Animal\n  name: string');
      const field = result.classes[0].members[0];
      expect(field.name).toBe('name');
      expect(field.type).toBe('string');
      expect(field.visibility).toBe('public');
      expect(field.isMethod).toBe(false);
    });

    it('parses public field with + prefix', () => {
      const result = parseClassDiagram('Animal\n  + name: string');
      const field = result.classes[0].members[0];
      expect(field.visibility).toBe('public');
      expect(field.name).toBe('name');
    });

    it('parses private field', () => {
      const result = parseClassDiagram('Animal\n  - id: number');
      const field = result.classes[0].members[0];
      expect(field.visibility).toBe('private');
      expect(field.name).toBe('id');
    });

    it('parses protected field', () => {
      const result = parseClassDiagram('Animal\n  # age: number');
      const field = result.classes[0].members[0];
      expect(field.visibility).toBe('protected');
    });

    it('parses static field', () => {
      const result = parseClassDiagram('Animal\n  count: number {static}');
      const field = result.classes[0].members[0];
      expect(field.isStatic).toBe(true);
    });

    it('tracks field line numbers', () => {
      const result = parseClassDiagram('Animal\n  name: string\n  age: number');
      expect(result.classes[0].members[0].lineNumber).toBe(2);
      expect(result.classes[0].members[1].lineNumber).toBe(3);
    });
  });

  // === Methods ===
  describe('methods', () => {
    it('parses method with no params', () => {
      const result = parseClassDiagram('Animal\n  speak(): void');
      const method = result.classes[0].members[0];
      expect(method.isMethod).toBe(true);
      expect(method.name).toBe('speak');
      expect(method.params).toBe('');
      expect(method.type).toBe('void');
    });

    it('parses method with params', () => {
      const result = parseClassDiagram('Animal\n  setName(name: string): void');
      const method = result.classes[0].members[0];
      expect(method.name).toBe('setName');
      expect(method.params).toBe('name: string');
      expect(method.type).toBe('void');
    });

    it('parses method with no return type', () => {
      const result = parseClassDiagram('Animal\n  doSomething()');
      const method = result.classes[0].members[0];
      expect(method.isMethod).toBe(true);
      expect(method.type).toBeUndefined();
    });

    it('parses static method', () => {
      const result = parseClassDiagram('Animal\n  create(): Animal {static}');
      const method = result.classes[0].members[0];
      expect(method.isStatic).toBe(true);
      expect(method.isMethod).toBe(true);
    });

    it('parses private method', () => {
      const result = parseClassDiagram('Animal\n  - validate(): boolean');
      const method = result.classes[0].members[0];
      expect(method.visibility).toBe('private');
      expect(method.isMethod).toBe(true);
    });
  });

  // === Enum values ===
  describe('enum values', () => {
    it('parses enum values as plain text', () => {
      const result = parseClassDiagram('Status [enum]\n  Active\n  Inactive\n  Pending');
      const members = result.classes[0].members;
      expect(members).toHaveLength(3);
      expect(members[0].name).toBe('Active');
      expect(members[1].name).toBe('Inactive');
      expect(members[2].name).toBe('Pending');
      expect(members[0].isMethod).toBe(false);
    });
  });

  // === Relationships — keyword syntax ===
  describe('relationships (keywords)', () => {
    it('parses extends', () => {
      const result = parseClassDiagram('Animal\n  name: string\n\nDog extends Animal');
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].type).toBe('extends');
      expect(result.relationships[0].source).toBe('dog');
      expect(result.relationships[0].target).toBe('animal');
    });

    it('parses implements', () => {
      const result = parseClassDiagram('Drawable [interface]\n  draw(): void\n\nCircle implements Drawable');
      expect(result.relationships[0].type).toBe('implements');
    });

    it('parses contains (composition)', () => {
      const result = parseClassDiagram('Car\n  engine: Engine\n\nCar contains Engine');
      expect(result.relationships[0].type).toBe('composes');
    });

    it('parses has (aggregation)', () => {
      const result = parseClassDiagram('Library\n  books: Book[]\n\nLibrary has Book');
      expect(result.relationships[0].type).toBe('aggregates');
    });

    it('parses uses (dependency)', () => {
      const result = parseClassDiagram('Controller\n  handle(): void\n\nController uses Service');
      expect(result.relationships[0].type).toBe('depends');
    });

    it('parses relationship with label', () => {
      const result = parseClassDiagram('Dog extends Animal : inherits behavior');
      expect(result.relationships[0].label).toBe('inherits behavior');
    });
  });

  // === Relationships — arrow syntax ===
  describe('relationships (arrows)', () => {
    it('parses --|> (extends)', () => {
      const result = parseClassDiagram('Dog --|> Animal');
      expect(result.relationships[0].type).toBe('extends');
    });

    it('parses ..|> (implements)', () => {
      const result = parseClassDiagram('Circle ..|> Drawable');
      expect(result.relationships[0].type).toBe('implements');
    });

    it('parses *-- (composition)', () => {
      const result = parseClassDiagram('Car *-- Engine');
      expect(result.relationships[0].type).toBe('composes');
    });

    it('parses o-- (aggregation)', () => {
      const result = parseClassDiagram('Library o-- Book');
      expect(result.relationships[0].type).toBe('aggregates');
    });

    it('parses ..> (dependency)', () => {
      const result = parseClassDiagram('Controller ..> Service');
      expect(result.relationships[0].type).toBe('depends');
    });

    it('parses -> (association)', () => {
      const result = parseClassDiagram('Student -> Course');
      expect(result.relationships[0].type).toBe('associates');
    });

    it('parses arrow with label', () => {
      const result = parseClassDiagram('Dog --|> Animal : inherits');
      expect(result.relationships[0].label).toBe('inherits');
    });
  });

  // === Relationship line numbers ===
  describe('relationship line numbers', () => {
    it('tracks relationship line numbers', () => {
      const result = parseClassDiagram('Animal\n  name: string\n\nDog extends Animal');
      expect(result.relationships[0].lineNumber).toBe(4);
    });
  });

  // === Auto-creates classes from relationships ===
  describe('auto-create classes', () => {
    it('creates classes referenced in relationships', () => {
      const result = parseClassDiagram('Dog extends Animal');
      expect(result.classes).toHaveLength(2);
      expect(result.classes.map(c => c.name).sort()).toEqual(['Animal', 'Dog']);
    });
  });

  // === Edge cases ===
  describe('edge cases', () => {
    it('handles class with only methods', () => {
      const result = parseClassDiagram('Service\n  start(): void\n  stop(): void');
      expect(result.classes[0].members.every(m => m.isMethod)).toBe(true);
    });

    it('handles multiple classes', () => {
      const result = parseClassDiagram('Animal\n  name: string\n\nDog\n  breed: string');
      expect(result.classes).toHaveLength(2);
    });

    it('returns error for empty input', () => {
      const result = parseClassDiagram('');
      expect(result.error).toBeDefined();
      // diagnostics
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(0);
    });

    it('handles mixed fields and methods', () => {
      const result = parseClassDiagram('Animal\n  name: string\n  speak(): void\n  age: number');
      const members = result.classes[0].members;
      expect(members).toHaveLength(3);
      expect(members[0].isMethod).toBe(false);
      expect(members[1].isMethod).toBe(true);
      expect(members[2].isMethod).toBe(false);
    });
  });
});

describe('looksLikeClassDiagram', () => {
  it('detects class with modifier', () => {
    expect(looksLikeClassDiagram('Animal [abstract]\n  name: string')).toBe(true);
  });

  it('detects interface modifier', () => {
    expect(looksLikeClassDiagram('Drawable [interface]\n  draw(): void')).toBe(true);
  });

  it('detects enum modifier', () => {
    expect(looksLikeClassDiagram('Color [enum]\n  Red\n  Green')).toBe(true);
  });

  it('detects relationship keywords with members', () => {
    expect(looksLikeClassDiagram('Animal\n  name: string\nDog extends Animal')).toBe(true);
  });

  it('detects relationship arrows with members', () => {
    expect(looksLikeClassDiagram('Animal\n  name: string\nDog --|> Animal')).toBe(true);
  });

  it('does not false-positive on flowcharts', () => {
    expect(looksLikeClassDiagram('(Start) -> [Process] -> (End)')).toBe(false);
  });

  it('does not false-positive on plain text', () => {
    expect(looksLikeClassDiagram('Hello World\nThis is just text')).toBe(false);
  });

  it('does not false-positive on sequence diagrams', () => {
    expect(looksLikeClassDiagram('Alice -> Bob: Hello\nBob -> Alice: Hi')).toBe(false);
  });
});
