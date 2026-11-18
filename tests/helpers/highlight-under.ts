// Writes a data chart's `highlight` the way an author does (#2080): indented
// under each named row — a data row, a series name in a `series` / `stack` /
// `group` block, or a scatter `[Group]` header — so a test can name what it
// lights without spelling the line out every time.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlightUnder(
  src: string,
  names: readonly string[],
  color?: string
): string {
  const res = names.map(
    (n) =>
      new RegExp(`^(\\s*)(?:\\[${esc(n)}\\].*|${esc(n)}(?:\\s+-?[\\d.]+.*)?)$`)
  );
  const out: string[] = [];
  for (const line of src.split('\n')) {
    out.push(line);
    const hit = res.map((re) => line.match(re)).find(Boolean);
    if (hit) out.push(`${hit[1]}  highlight${color ? ` ${color}` : ''}`);
  }
  return out.join('\n');
}
