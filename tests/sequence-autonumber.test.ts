import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';

let doc: Document;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  doc = win.document;
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

function labels(input: string): string[] {
  const parsed = parseSequenceDgmo(input);
  expect(parsed.error).toBeNull();
  const container = doc.createElement('div') as unknown as HTMLDivElement;
  renderSequenceDiagram(
    container,
    parsed,
    getPalette('nord').light,
    false,
    undefined,
    {
      exportWidth: 800,
    }
  );
  return Array.from(container.querySelectorAll('.message-label')).map(
    (node) => node.textContent ?? ''
  );
}

describe('sequence autonumber', () => {
  it('parses as a header directive', () => {
    const parsed = parseSequenceDgmo('sequence\nautonumber\nA -hello-> B');
    expect(parsed.error).toBeNull();
    expect(parsed.options.autonumber).toBe('on');
  });

  it('numbers labeled and unlabeled source messages in order', () => {
    expect(
      labels('sequence\nautonumber\nA -request-> B\nB -> C\nC -done-> A')
    ).toEqual(['1. request', '2', '3. done']);
  });

  it('does not number inferred return arrows', () => {
    expect(labels('sequence\nautonumber\nA -request-> B\nB -work-> C')).toEqual(
      ['1. request', '2. work']
    );
  });

  it('numbers an explicit unlabeled response', () => {
    expect(labels('sequence\nautonumber\nA -request-> B\nB -> A')).toEqual([
      '1. request',
      '2',
    ]);
  });

  it('leaves message labels unchanged when autonumber is absent', () => {
    expect(labels('sequence\nA -request-> B\nB -> C')).toEqual(['request']);
  });
});
