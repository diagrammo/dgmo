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

/**
 * Cast a raw value to a branded type. The only legal "mint" point —
 * call this at the boundary where unbranded data (parser input,
 * external API) enters branded territory.
 *
 *   const id = asBrand<NodeId>(rawString);
 *
 * Inverts trivially: a `Brand<T, B>` is assignable to `T` without a
 * cast, so consumers that want the underlying primitive lose the
 * brand naturally.
 */
export function asBrand<B>(
  value: B extends Brand<infer T, string> ? T : never
): B {
  return value as B;
}
