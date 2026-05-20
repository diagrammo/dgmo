import { describe, it, expect, beforeEach } from 'vitest';
import { parseWireframe, resetWireframeIds } from '../src/wireframe/parser';

beforeEach(() => {
  resetWireframeIds();
});

describe('wireframe parser', () => {
  describe('chart type declaration', () => {
    it('parses wireframe with title', () => {
      const result = parseWireframe('wireframe Login Page');
      expect(result.title).toBe('Login Page');
      expect(result.error).toBeNull();
    });

    it('parses wireframe without title', () => {
      const result = parseWireframe('wireframe');
      expect(result.title).toBeNull();
      expect(result.error).toBeNull();
    });

    it('defaults to desktop form factor', () => {
      const result = parseWireframe('wireframe Test');
      expect(result.formFactor).toBe('desktop');
    });
  });

  describe('mobile option', () => {
    it('parses mobile keyword', () => {
      const result = parseWireframe('wireframe Test\nmobile');
      expect(result.formFactor).toBe('mobile');
    });
  });

  describe('groups and text inputs', () => {
    it('parses [Group] with children as container', () => {
      const result = parseWireframe(
        'wireframe Test\n[Sidebar]\n  Some text\n  Another line'
      );
      expect(result.roots).toHaveLength(1);
      const group = result.roots[0];
      expect(group.type).toBe('group');
      expect(group.label).toBe('Sidebar');
      expect(group.isContainer).toBe(true);
      expect(group.children).toHaveLength(2);
    });

    it('parses [text] without children as text input', () => {
      const result = parseWireframe(
        'wireframe Test\n[Sidebar]\n  [Email address]'
      );
      const field = result.roots[0].children[0];
      expect(field.type).toBe('textInput');
      expect(field.label).toBe('Email address');
      expect(field.isContainer).toBe(false);
    });

    it('handles nested groups 3+ levels deep', () => {
      const src = [
        'wireframe Test',
        '[A]',
        '  [B]',
        '    [C]',
        '      Some text',
      ].join('\n');
      const result = parseWireframe(src);
      expect(result.roots[0].type).toBe('group');
      expect(result.roots[0].children[0].type).toBe('group');
      expect(result.roots[0].children[0].children[0].type).toBe('group');
      expect(result.roots[0].children[0].children[0].children[0].type).toBe(
        'text'
      );
    });

    it('parses | horizontal on groups', () => {
      const result = parseWireframe(
        'wireframe Test\n[Cards] | horizontal\n  Card 1\n  Card 2'
      );
      expect(result.roots[0].orientation).toBe('horizontal');
      expect(result.roots[0].isContainer).toBe(true);
    });

    it('empty group with group-only metadata is container (EC1)', () => {
      const result = parseWireframe('wireframe Test\n[Sidebar] | horizontal');
      expect(result.roots[0].type).toBe('group');
      expect(result.roots[0].isContainer).toBe(true);
    });

    it('empty group with scrollable is container (EC1)', () => {
      const result = parseWireframe('wireframe Test\n[Messages] | scrollable');
      expect(result.roots[0].type).toBe('group');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].states).toContain('scrollable');
    });
  });

  describe('buttons', () => {
    it('parses (Button Label)', () => {
      const result = parseWireframe('wireframe Test\n(Submit)');
      expect(result.roots[0].type).toBe('button');
      expect(result.roots[0].label).toBe('Submit');
    });

    it('parses button with states', () => {
      const result = parseWireframe('wireframe Test\n(Delete) | destructive');
      expect(result.roots[0].type).toBe('button');
      expect(result.roots[0].states).toContain('destructive');
    });

    it('parses ghost button', () => {
      const result = parseWireframe('wireframe Test\n(Cancel) | ghost');
      expect(result.roots[0].states).toContain('ghost');
    });
  });

  describe('headings', () => {
    it('parses # heading', () => {
      const result = parseWireframe('wireframe Test\n# Main Title');
      expect(result.roots[0].type).toBe('heading');
      expect(result.roots[0].label).toBe('Main Title');
      expect(result.roots[0].headingLevel).toBe(1);
    });

    it('parses ## subheading', () => {
      const result = parseWireframe('wireframe Test\n## Subtitle');
      expect(result.roots[0].type).toBe('heading');
      expect(result.roots[0].headingLevel).toBe(2);
    });
  });

  describe('dividers', () => {
    it('parses --- as divider', () => {
      const result = parseWireframe('wireframe Test\n---');
      expect(result.roots[0].type).toBe('divider');
    });

    it('parses longer dashes as divider', () => {
      const result = parseWireframe('wireframe Test\n-----');
      expect(result.roots[0].type).toBe('divider');
    });
  });

  describe('bare text', () => {
    it('parses bare text as text element', () => {
      const result = parseWireframe('wireframe Test\nSome description');
      expect(result.roots[0].type).toBe('text');
      expect(result.roots[0].label).toBe('Some description');
    });

    it('bare text with semantic state becomes alert (F22)', () => {
      const result = parseWireframe(
        'wireframe Test\nPayment failed | destructive'
      );
      expect(result.roots[0].type).toBe('alert');
      expect(result.roots[0].states).toContain('destructive');
    });
  });

  describe('label-field inline pattern', () => {
    it('parses label  [field] as label-for pair', () => {
      const result = parseWireframe('wireframe Test\n[Form]\n  Name  [John]');
      const form = result.roots[0];
      expect(form.children).toHaveLength(1);
      const wrapper = form.children[0];
      expect(wrapper.metadata._labelField).toBe('true');
      expect(wrapper.children).toHaveLength(2);
      expect(wrapper.children[0].type).toBe('text');
      expect(wrapper.children[0].label).toBe('Name');
      expect(wrapper.children[1].type).toBe('textInput');
      expect(wrapper.children[1].label).toBe('John');
    });
  });

  describe('comments', () => {
    it('skips comment lines', () => {
      const result = parseWireframe(
        'wireframe Test\n// This is a comment\n(Button)'
      );
      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].type).toBe('button');
    });

    it('comments interleaved with elements have no impact (EC9)', () => {
      const result = parseWireframe('wireframe Test\n(A)\n// comment\n(B)');
      expect(result.roots).toHaveLength(2);
    });
  });

  describe('dropdowns', () => {
    it('parses {Option A | Option B | Option C}', () => {
      const result = parseWireframe('wireframe Test\n{Small | Medium | Large}');
      expect(result.roots[0].type).toBe('dropdown');
      expect(result.roots[0].options).toEqual(['Small', 'Medium', 'Large']);
    });

    it('single-option dropdown is valid (EC4)', () => {
      const result = parseWireframe('wireframe Test\n{Active}');
      expect(result.roots[0].type).toBe('dropdown');
      expect(result.roots[0].options).toEqual(['Active']);
    });

    it('parses dropdown with metadata', () => {
      const result = parseWireframe('wireframe Test\n{A | B | C} | disabled');
      expect(result.roots[0].type).toBe('dropdown');
      expect(result.roots[0].states).toContain('disabled');
    });
  });

  describe('checkboxes', () => {
    it('parses <x> as checked checkbox', () => {
      const result = parseWireframe('wireframe Test\n<x>');
      expect(result.roots[0].type).toBe('checkbox');
      expect(result.roots[0].checked).toBe(true);
    });

    it('parses < > as unchecked checkbox', () => {
      const result = parseWireframe('wireframe Test\n< >');
      expect(result.roots[0].type).toBe('checkbox');
      expect(result.roots[0].checked).toBe(false);
    });

    it('whitespace-tolerant checkbox (EC6)', () => {
      const result = parseWireframe('wireframe Test\n< x >');
      expect(result.roots[0].type).toBe('checkbox');
      expect(result.roots[0].checked).toBe(true);
    });

    it('<hello> is bare text, not checkbox (EC6)', () => {
      const result = parseWireframe('wireframe Test\n<hello>');
      expect(result.roots[0].type).toBe('text');
    });

    it('parses checkbox with label', () => {
      const result = parseWireframe('wireframe Test\n<x> Dark mode');
      expect(result.roots[0].type).toBe('checkbox');
      expect(result.roots[0].label).toBe('Dark mode');
      expect(result.roots[0].checked).toBe(true);
    });

    it('parses checkbox with toggle metadata', () => {
      const result = parseWireframe('wireframe Test\n<x> Dark mode | toggle');
      expect(result.roots[0].type).toBe('checkbox');
      expect(result.roots[0].states).toContain('toggle');
    });
  });

  describe('radio buttons', () => {
    it('parses (*) as selected radio', () => {
      const result = parseWireframe('wireframe Test\n(*) Option A');
      expect(result.roots[0].type).toBe('radio');
      expect(result.roots[0].selected).toBe(true);
      expect(result.roots[0].label).toBe('Option A');
    });

    it('parses ( ) as unselected radio', () => {
      const result = parseWireframe('wireframe Test\n( ) Option B');
      expect(result.roots[0].type).toBe('radio');
      expect(result.roots[0].selected).toBe(false);
    });
  });

  describe('list items', () => {
    it('parses - item as list item', () => {
      const result = parseWireframe('wireframe Test\n- First item');
      expect(result.roots[0].type).toBe('listItem');
      expect(result.roots[0].label).toBe('First item');
    });

    it('does not trigger list detection mid-text (F38)', () => {
      const result = parseWireframe(
        'wireframe Test\nIn stock - ships within 2 days'
      );
      expect(result.roots[0].type).toBe('text');
    });
  });

  describe('keyword elements', () => {
    it('parses nav block', () => {
      const result = parseWireframe('wireframe Test\nnav\n  Home\n  About');
      expect(result.roots[0].type).toBe('nav');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].children).toHaveLength(2);
    });

    it('parses tabs block', () => {
      const result = parseWireframe('wireframe Test\ntabs\n  Tab 1\n  Tab 2');
      expect(result.roots[0].type).toBe('tabs');
      expect(result.roots[0].isContainer).toBe(true);
    });

    it('parses image leaf', () => {
      const result = parseWireframe('wireframe Test\nimage');
      expect(result.roots[0].type).toBe('image');
      expect(result.roots[0].imageHint).toBe('default');
    });

    it('parses image round', () => {
      const result = parseWireframe('wireframe Test\nimage round');
      expect(result.roots[0].type).toBe('image');
      expect(result.roots[0].imageHint).toBe('round');
    });

    it('parses image wide', () => {
      const result = parseWireframe('wireframe Test\nimage wide');
      expect(result.roots[0].type).toBe('image');
      expect(result.roots[0].imageHint).toBe('wide');
    });

    it('image with unrecognized words is bare text (F9)', () => {
      const result = parseWireframe(
        'wireframe Test\nimage quality is important'
      );
      expect(result.roots[0].type).toBe('text');
    });

    it('parses progress with value', () => {
      const result = parseWireframe('wireframe Test\nprogress 60');
      expect(result.roots[0].type).toBe('progress');
      expect(result.roots[0].progressValue).toBe(60);
    });

    it('clamps progress values', () => {
      const result = parseWireframe('wireframe Test\nprogress 150');
      expect(result.roots[0].progressValue).toBe(100);
    });

    it('parses chart with hint', () => {
      const result = parseWireframe('wireframe Test\nchart bar');
      expect(result.roots[0].type).toBe('chart');
      expect(result.roots[0].chartHint).toBe('bar');
    });

    it('parses modal as separate element', () => {
      const result = parseWireframe(
        'wireframe Test\nmodal Confirm Delete\n  Are you sure?\n  (Delete) | destructive'
      );
      expect(result.modals).toHaveLength(1);
      expect(result.modals[0].type).toBe('modal');
      expect(result.modals[0].label).toBe('Confirm Delete');
      expect(result.modals[0].children).toHaveLength(2);
    });

    it('parses skeleton block', () => {
      const result = parseWireframe(
        'wireframe Test\nskeleton\n  [Input]\n  (Button)'
      );
      expect(result.roots[0].type).toBe('skeleton');
      expect(result.roots[0].children).toHaveLength(2);
      expect(result.roots[0].children[0].isSkeleton).toBe(true);
      expect(result.roots[0].children[1].isSkeleton).toBe(true);
    });

    it('parses alert block', () => {
      const result = parseWireframe(
        'wireframe Test\nalert\n  Something happened'
      );
      expect(result.roots[0].type).toBe('alert');
    });
  });

  describe('table', () => {
    it('parses table with header and data rows', () => {
      const result = parseWireframe(
        'wireframe Test\ntable\n  Name, Email, Role\n  John, john@, Admin'
      );
      const table = result.roots[0];
      expect(table.type).toBe('table');
      expect(table.tableHeaders).toEqual(['Name', 'Email', 'Role']);
      expect(table.tableData).toEqual([['John', 'john@', 'Admin']]);
    });

    it('parses table skeleton shorthand', () => {
      const result = parseWireframe(
        'wireframe Test\ntable 5x4\n  Name, Email, Role, Status'
      );
      const table = result.roots[0];
      expect(table.type).toBe('table');
      expect(table.tableRows).toBe(5);
      expect(table.tableCols).toBe(4);
    });

    it('table followed by non-indented line is empty table (EC10)', () => {
      const result = parseWireframe('wireframe Test\ntable\nSome text');
      expect(result.roots[0].type).toBe('table');
      expect(result.roots[1].type).toBe('text');
    });
  });

  describe('multi-element lines', () => {
    it('orphaned pipe attaches to preceding element (EC5)', () => {
      const result = parseWireframe(
        'wireframe Test\n[Form]\n  (Submit)  | primary'
      );
      const form = result.roots[0];
      expect(form.children).toHaveLength(1);
      expect(form.children[0].type).toBe('button');
      expect(form.children[0].states).toContain('primary');
    });

    it('Cart (3) is single text, not text + button', () => {
      const result = parseWireframe('wireframe Test\nCart (3)');
      // Single space means same element — treated as bare text
      expect(result.roots[0].type).toBe('text');
      expect(result.roots[0].label).toBe('Cart (3)');
    });

    it('three segments are inline items wrapped in horizontal row', () => {
      const result = parseWireframe('wireframe Test\n(-)  1  (+)');
      expect(result.roots).toHaveLength(1);
      const row = result.roots[0];
      expect(row.orientation).toBe('horizontal');
      expect(row.children).toHaveLength(3);
      expect(row.children[0].type).toBe('button');
      expect(row.children[1].type).toBe('text');
      expect(row.children[2].type).toBe('button');
    });
  });

  describe('field variants', () => {
    it('parses password variant', () => {
      const result = parseWireframe('wireframe Test\n[****] | password');
      expect(result.roots[0].type).toBe('textInput');
      expect(result.roots[0].fieldVariant).toBe('password');
    });

    it('parses textarea variant', () => {
      const result = parseWireframe('wireframe Test\n[Description] | textarea');
      expect(result.roots[0].type).toBe('textInput');
      expect(result.roots[0].fieldVariant).toBe('textarea');
    });
  });

  describe('text input with disabled state', () => {
    it('parses disabled input', () => {
      const result = parseWireframe('wireframe Test\n[Email] | disabled');
      expect(result.roots[0].type).toBe('textInput');
      expect(result.roots[0].states).toContain('disabled');
    });
  });

  describe('collapsed group', () => {
    it('parses collapsed group', () => {
      const result = parseWireframe('wireframe Test\n[Advanced] | collapsed');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].states).toContain('collapsed');
    });
  });

  describe('tag groups', () => {
    it('parses tag group with entries', () => {
      const result = parseWireframe(
        'wireframe Test\ntag Status s\n  Active green\n  Inactive gray\n[Form]\n  (Submit)'
      );
      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].name).toBe('Status');
      expect(result.tagGroups[0].entries).toHaveLength(2);
    });
  });

  describe('reference example (e-commerce product page)', () => {
    it('parses the full reference example without errors', () => {
      const src = `wireframe E-Commerce Product Page

[Header]
  [Logo + Nav] | horizontal
    Acme Store
    nav
      Products | active
      Categories
      Deals
      About
  [User] | horizontal
    [Search products...]
    Cart (3)
    Sign In

[Sidebar]
  ## Categories
  - Electronics
  - Clothing
  - Home & Garden
  - Sports
  ---
  ## Price Range
  Min  [0]
  Max  [500]
  (Apply)

[Main]
  Home > Products > Headphones

  # Wireless Noise-Canceling Headphones
  $299.99  ~~$349.99~~

  [Product Info] | horizontal
    [Images]
      image
      [Thumbnails] | horizontal
        image  image  image

    [Details]
      ## Color
      (*) Black  ( ) White  ( ) Navy

      ## Quantity
      (-)  1  (+)

      (Add to Cart) | success
      (Buy Now)
      (Add to Wishlist) | ghost

      ---
      Free shipping on orders over $50
      In stock - ships within 2 days | success

  ---

  tabs
    Description | active
    Specifications
    Reviews (47)

  Long product description text goes here.

  ## You Might Also Like
  [Recommendations] | horizontal
    [Product Card]
      image
      Similar Product 1
      $199.99
      (Add to Cart) | ghost
    [Product Card]
      image
      Similar Product 2
      $149.99
      (Add to Cart) | ghost

[Footer]
  [Links] | horizontal
    About Us
    Contact
    Privacy Policy
    Terms of Service
  © 2026 Acme Store`;

      const result = parseWireframe(src);
      expect(result.title).toBe('E-Commerce Product Page');
      expect(result.error).toBeNull();
      // Should have 4 top-level groups: Header, Sidebar, Main, Footer
      expect(result.roots).toHaveLength(4);
      expect(result.roots[0].label).toBe('Header');
      expect(result.roots[1].label).toBe('Sidebar');
      expect(result.roots[2].label).toBe('Main');
      expect(result.roots[3].label).toBe('Footer');
    });
  });

  describe('error recovery', () => {
    it('suggests braces for parens with pipes (AC25)', () => {
      const result = parseWireframe('wireframe Test\n(Admin | Editor)');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain('{Admin | Editor}');
      // Should still parse as dropdown (generous)
      expect(result.roots[0].type).toBe('dropdown');
    });

    it('warns and auto-closes unmatched [ (AC26)', () => {
      const result = parseWireframe('wireframe Test\n[unclosed');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain("Unmatched '['");
      expect(result.roots[0].type).toBe('textInput');
      expect(result.roots[0].label).toBe('unclosed');
    });

    it('warns and auto-closes unmatched (', () => {
      const result = parseWireframe('wireframe Test\n(unclosed');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.roots[0].type).toBe('button');
    });

    it('warns and auto-closes unmatched {', () => {
      const result = parseWireframe('wireframe Test\n{A | B');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.roots[0].type).toBe('dropdown');
      expect(result.roots[0].options).toEqual(['A', 'B']);
    });

    it('empty wireframe is valid but empty', () => {
      const result = parseWireframe('wireframe Title');
      expect(result.title).toBe('Title');
      expect(result.roots).toHaveLength(0);
      expect(result.error).toBeNull();
    });

    it('unknown keyword treated as bare text', () => {
      const result = parseWireframe('wireframe Test\nfoobar');
      expect(result.roots[0].type).toBe('text');
      expect(result.roots[0].label).toBe('foobar');
    });

    it('deeply nested groups (5+ levels) parsed correctly', () => {
      const src = [
        'wireframe Test',
        '[A]',
        '  [B]',
        '    [C]',
        '      [D]',
        '        [E]',
        '          text',
      ].join('\n');
      const result = parseWireframe(src);
      let node = result.roots[0];
      for (let i = 0; i < 4; i++) {
        expect(node.isContainer).toBe(true);
        node = node.children[0];
      }
      expect(node.isContainer).toBe(true);
      expect(node.children[0].type).toBe('text');
    });

    it('20+ elements in one group parsed correctly (scale test)', () => {
      const lines = ['wireframe Test', '[Form]'];
      for (let i = 0; i < 25; i++) {
        lines.push(`  [Field ${i}]`);
      }
      const result = parseWireframe(lines.join('\n'));
      expect(result.roots[0].children).toHaveLength(25);
    });

    it('mixed tabs and spaces are handled', () => {
      const result = parseWireframe('wireframe Test\n[Group]\n\t[Nested]');
      expect(result.roots[0].isContainer).toBe(true);
      expect(result.roots[0].children).toHaveLength(1);
    });
  });
});
