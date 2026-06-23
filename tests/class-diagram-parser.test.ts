import { describe, it, expect } from 'vitest';
import { parseClassDiagram, looksLikeClassDiagram } from '../src/class/parser';

describe('parseClassDiagram', () => {
  // === Metadata ===
  describe('metadata', () => {
    it('parses bare class keyword on first line', () => {
      const result = parseClassDiagram('class\nAnimal\n  name: string');
      expect(result.type).toBe('class');
      expect(result.error).toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it('parses class keyword with title on first line', () => {
      const result = parseClassDiagram(
        'class My Classes\nAnimal\n  name: string'
      );
      expect(result.type).toBe('class');
      expect(result.title).toBe('My Classes');
      expect(result.titleLineNumber).toBe(1);
      expect(result.error).toBeNull();
    });

    it('warns on removed no-auto-color option', () => {
      const result = parseClassDiagram(
        'class\nno-auto-color\nAnimal\n  name: string'
      );
      expect(
        result.diagnostics.some(
          (d) =>
            d.severity === 'warning' &&
            d.message.includes('"no-auto-color" was removed')
        )
      ).toBe(true);
    });
  });

  // === Comments ===
  describe('comments', () => {
    it('ignores // comments', () => {
      const result = parseClassDiagram(
        '// this is a comment\nAnimal\n  name: string'
      );
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

    it('parses abstract class with bare keyword', () => {
      const result = parseClassDiagram('abstract Animal\n  name: string');
      expect(result.classes[0].modifier).toBe('abstract');
      expect(result.classes[0].name).toBe('Animal');
    });

    it('parses interface with bare keyword', () => {
      const result = parseClassDiagram('interface Drawable\n  draw(): void');
      expect(result.classes[0].modifier).toBe('interface');
      expect(result.classes[0].name).toBe('Drawable');
    });

    it('parses enum with bare keyword', () => {
      const result = parseClassDiagram('enum Color\n  Red\n  Green\n  Blue');
      expect(result.classes[0].modifier).toBe('enum');
      expect(result.classes[0].name).toBe('Color');
      expect(result.classes[0].members).toHaveLength(3);
    });

    it('parses class with color', () => {
      const result = parseClassDiagram('Animal red\n  name: string');
      expect(result.classes[0].color).toBeDefined();
    });

    it('parses class with bare modifier and color', () => {
      const result = parseClassDiagram('abstract Animal blue\n  name: string');
      expect(result.classes[0].modifier).toBe('abstract');
      expect(result.classes[0].color).toBeDefined();
    });

    it('tracks line numbers', () => {
      const result = parseClassDiagram('class Test\n\nAnimal\n  name: string');
      expect(result.classes[0].lineNumber).toBe(3);
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
      const result = parseClassDiagram(
        'enum Status\n  Active\n  Inactive\n  Pending'
      );
      const members = result.classes[0].members;
      expect(members).toHaveLength(3);
      expect(members[0].name).toBe('Active');
      expect(members[1].name).toBe('Inactive');
      expect(members[2].name).toBe('Pending');
      expect(members[0].isMethod).toBe(false);
    });
  });

  // === Inline extends/implements ===
  describe('inline extends/implements', () => {
    it('parses extends in class declaration', () => {
      const result = parseClassDiagram(
        'Animal\n  name: string\n\nDog extends Animal\n  breed: string'
      );
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].type).toBe('extends');
      expect(result.relationships[0].source).toBe('dog');
      expect(result.relationships[0].target).toBe('animal');
      // Dog should have its member
      const dog = result.classes.find((c) => c.name === 'Dog')!;
      expect(dog.members).toHaveLength(1);
      expect(dog.members[0].name).toBe('breed');
    });

    it('parses implements in class declaration', () => {
      const result = parseClassDiagram(
        'interface Drawable\n  draw(): void\n\nCircle implements Drawable\n  - radius: number'
      );
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].type).toBe('implements');
      expect(result.relationships[0].source).toBe('circle');
      expect(result.relationships[0].target).toBe('drawable');
    });

    it('auto-creates parent class from extends', () => {
      const result = parseClassDiagram('Dog extends Animal\n  breed: string');
      expect(result.classes).toHaveLength(2);
      expect(result.classes.map((c) => c.name).sort()).toEqual([
        'Animal',
        'Dog',
      ]);
    });

    it('extends with modifier', () => {
      const result = parseClassDiagram(
        'abstract Shape\n  + area(): number\n\nCircle extends Shape\n  - radius: number'
      );
      expect(result.relationships[0].type).toBe('extends');
      expect(result.relationships[0].source).toBe('circle');
      expect(result.relationships[0].target).toBe('shape');
    });

    it('extends with color', () => {
      const result = parseClassDiagram(
        'Dog extends Animal red\n  breed: string'
      );
      expect(result.relationships[0].type).toBe('extends');
      const dog = result.classes.find((c) => c.name === 'Dog')!;
      expect(dog.color).toBeDefined();
    });

    it('extends with no members', () => {
      const result = parseClassDiagram(
        'Animal\n  name: string\n\nDog extends Animal'
      );
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].type).toBe('extends');
    });

    it('extends and implements on the same line', () => {
      const result = parseClassDiagram(
        'abstract Shape\n  + area(): number\n\ninterface Drawable\n  draw(): void\n\nCircle extends Shape implements Drawable\n  - radius: number'
      );
      // Three classes: Shape, Drawable, Circle
      expect(result.classes.map((c) => c.name).sort()).toEqual([
        'Circle',
        'Drawable',
        'Shape',
      ]);
      // Two relationships from Circle: extends Shape, implements Drawable
      expect(result.relationships).toHaveLength(2);
      const extendsRel = result.relationships.find((r) => r.type === 'extends');
      const implementsRel = result.relationships.find(
        (r) => r.type === 'implements'
      );
      expect(extendsRel?.source).toBe('circle');
      expect(extendsRel?.target).toBe('shape');
      expect(implementsRel?.source).toBe('circle');
      expect(implementsRel?.target).toBe('drawable');
      // Circle's member preserved
      const circle = result.classes.find((c) => c.name === 'Circle')!;
      expect(circle.members).toHaveLength(1);
      expect(circle.members[0].name).toBe('radius');
    });
  });

  // === Relationships — indented arrow syntax ===
  describe('relationships (indented arrows)', () => {
    it('parses --|> (extends)', () => {
      const result = parseClassDiagram('Dog\n  --|> Animal');
      expect(result.relationships[0].type).toBe('extends');
      expect(result.relationships[0].source).toBe('dog');
      expect(result.relationships[0].target).toBe('animal');
    });

    it('parses ..|> (implements)', () => {
      const result = parseClassDiagram('Circle\n  ..|> Drawable');
      expect(result.relationships[0].type).toBe('implements');
    });

    it('parses *-- (composition)', () => {
      const result = parseClassDiagram('Car\n  *-- Engine');
      expect(result.relationships[0].type).toBe('composes');
    });

    it('parses o-- (aggregation)', () => {
      const result = parseClassDiagram('Library\n  o-- Book');
      expect(result.relationships[0].type).toBe('aggregates');
    });

    it('parses ..> (dependency)', () => {
      const result = parseClassDiagram('Controller\n  ..> Service');
      expect(result.relationships[0].type).toBe('depends');
    });

    it('parses -> (association)', () => {
      const result = parseClassDiagram('Student\n  -> Course');
      expect(result.relationships[0].type).toBe('associates');
    });

    it('parses arrow with space-separated label', () => {
      const result = parseClassDiagram('Dog\n  --|> Animal inherits');
      expect(result.relationships[0].label).toBe('inherits');
    });

    it('parses arrow with colon-separated label', () => {
      const result = parseClassDiagram('Canvas\n  *-- Shape : contains');
      expect(result.relationships[0].type).toBe('composes');
      expect(result.relationships[0].label).toBe('contains');
    });

    it('source is the current class', () => {
      const result = parseClassDiagram(
        'Canvas\n  - shapes: Shape[]\n  *-- Shape'
      );
      expect(result.relationships[0].source).toBe('canvas');
      expect(result.relationships[0].target).toBe('shape');
    });

    it('multiple relationships under one class', () => {
      const result = parseClassDiagram('Canvas\n  *-- Shape\n  ..> Logger');
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].source).toBe('canvas');
      expect(result.relationships[1].source).toBe('canvas');
    });

    it('auto-creates target class', () => {
      const result = parseClassDiagram('Dog\n  --|> Animal');
      expect(result.classes.map((c) => c.name).sort()).toEqual([
        'Animal',
        'Dog',
      ]);
    });
  });

  // === Top-level relationships rejected ===
  describe('top-level relationships rejected', () => {
    it('rejects top-level --|> with warning', () => {
      const result = parseClassDiagram('Dog --|> Animal');
      expect(result.relationships).toHaveLength(0);
      expect(
        result.diagnostics.some((d) => d.message.includes('must be indented'))
      ).toBe(true);
    });

    it('rejects top-level *-- with warning', () => {
      const result = parseClassDiagram('Car *-- Engine');
      expect(result.relationships).toHaveLength(0);
      expect(
        result.diagnostics.some((d) => d.message.includes('must be indented'))
      ).toBe(true);
    });

    it('rejects top-level -> with warning', () => {
      const result = parseClassDiagram('Student -> Course');
      expect(result.relationships).toHaveLength(0);
    });
  });

  // === Relationship line numbers ===
  describe('relationship line numbers', () => {
    it('tracks inline extends line number', () => {
      const result = parseClassDiagram(
        'Animal\n  name: string\n\nDog extends Animal\n  breed: string'
      );
      expect(result.relationships[0].lineNumber).toBe(4);
    });

    it('tracks arrow relationship line number', () => {
      const result = parseClassDiagram(
        'Animal\n  name: string\n\nDog\n  breed: string\n  --|> Animal'
      );
      expect(result.relationships[0].lineNumber).toBe(6);
    });
  });

  // === Edge cases ===
  describe('§1.4 unified metadata grammar exemption', () => {
    it('class members `+ name: string` still parse correctly (class is exempt)', () => {
      const result = parseClassDiagram(
        'Ship\n  + name: string\n  + speed: number\n  + sail(): void'
      );
      expect(result.error).toBeNull();
      const ship = result.classes[0];
      const members = ship!.members;
      expect(members[0]!.name).toBe('name');
      expect(members[0]!.type).toBe('string');
      expect(members[1]!.name).toBe('speed');
      expect(members[1]!.type).toBe('number');
      expect(members[2]!.name).toBe('sail');
      expect(members[2]!.isMethod).toBe(true);
      // No pipe-removed diagnostic — class doesn't use `|` for metadata.
      const pipeDiag = result.diagnostics.find(
        (d) => d.code === 'E_PIPE_OPERATOR_REMOVED'
      );
      expect(pipeDiag).toBeUndefined();
    });

    it('class inheritance arrows `--|>` and `..|>` are not flagged as legacy pipes', () => {
      const result = parseClassDiagram(
        'abstract Vessel\n  + sail(): void\n\nGalleon\n  --|> Vessel'
      );
      const pipeDiag = result.diagnostics.find(
        (d) => d.code === 'E_PIPE_OPERATOR_REMOVED'
      );
      expect(pipeDiag).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('handles class with only methods', () => {
      const result = parseClassDiagram(
        'Service\n  start(): void\n  stop(): void'
      );
      expect(result.classes[0].members.every((m) => m.isMethod)).toBe(true);
    });

    it('handles multiple classes', () => {
      const result = parseClassDiagram(
        'Animal\n  name: string\n\nDog\n  breed: string'
      );
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
      const result = parseClassDiagram(
        'Animal\n  name: string\n  speak(): void\n  age: number'
      );
      const members = result.classes[0].members;
      expect(members).toHaveLength(3);
      expect(members[0].isMethod).toBe(false);
      expect(members[1].isMethod).toBe(true);
      expect(members[2].isMethod).toBe(false);
    });
  });
});

describe('looksLikeClassDiagram', () => {
  it('detects bare abstract keyword', () => {
    expect(looksLikeClassDiagram('abstract Animal\n  name: string')).toBe(true);
  });

  it('detects bare interface keyword', () => {
    expect(looksLikeClassDiagram('interface Drawable\n  draw(): void')).toBe(
      true
    );
  });

  it('detects bare enum keyword', () => {
    expect(looksLikeClassDiagram('enum Color\n  Red\n  Green')).toBe(true);
  });

  it('detects inline extends with members', () => {
    expect(
      looksLikeClassDiagram(
        'Animal\n  name: string\n\nDog extends Animal\n  breed: string'
      )
    ).toBe(true);
  });

  it('detects indented relationship arrows with members', () => {
    expect(
      looksLikeClassDiagram('Animal\n  name: string\nDog\n  --|> Animal')
    ).toBe(true);
  });

  it('does not false-positive on flowcharts', () => {
    expect(looksLikeClassDiagram('(Start) -> [Process] -> (End)')).toBe(false);
  });

  it('does not false-positive on plain text', () => {
    expect(looksLikeClassDiagram('Hello World\nThis is just text')).toBe(false);
  });

  it('does not false-positive on sequence diagrams', () => {
    expect(looksLikeClassDiagram('Alice -> Bob: Hello\nBob -> Alice: Hi')).toBe(
      false
    );
  });
});
