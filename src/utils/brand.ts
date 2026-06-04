// ============================================================
// Branded types — compile-time nominal typing
// ============================================================
//
// `Brand<T, B>` produces a type that is structurally `T` but
// nominally distinct from other brands and from plain `T`. The
// brand-marker property is `__brand` and is never actually written
// at runtime — TypeScript intersects the type purely for compile-
// time tracking.
//
// Used to catch ID-mixing bugs at compile time:
//
//   type NodeId = Brand<string, 'NodeId'>;
//   type GroupId = Brand<string, 'GroupId'>;
//
//   function findNode(id: NodeId): Node;
//   findNode(someGroupId);  // Type error — GroupId not assignable to NodeId.
//
// Brands erase fully at compile time: zero runtime cost, no
// transformation, no extra JS output.

/**
 * Tag a primitive type `T` with a phantom brand `B`. The brand
 * exists only in the type system — `Brand<string, 'X'>` is a `string`
 * at runtime, but TypeScript treats it as nominally distinct from
 * plain `string` and from any other `Brand<string, ...>`.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ============================================================
// Writable<T> — escape hatch for parsers that need a mutable
// construction phase before returning a `readonly`-typed value.
// ============================================================
//
// Usage:
//
//   interface ParsedKanban {
//     readonly columns: readonly KanbanColumn[];
//     ...
//   }
//
//   function parseKanban(): ParsedKanban {
//     const result: Writable<ParsedKanban> = { columns: [], ... };
//     result.columns.push(...); // OK — Writable strips the readonly
//     return result;             // OK — assignable back to ParsedKanban
//   }
//
// `Writable<T>` flips `readonly` modifiers off shallowly. Nested
// `readonly` arrays/objects keep their immutability — `WritableDeep`
// is intentionally NOT provided because parsers rarely need it and
// it's a sharp tool.

/**
 * Strip top-level `readonly` modifiers from an object type, including
 * unwrapping `readonly T[]` array fields to mutable `T[]`. Element types
 * inside arrays/objects keep their own immutability — Writable is
 * intentionally shallow.
 */
export type Writable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K];
};
