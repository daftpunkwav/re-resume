/**
 * @file compositionOrder
 * @description The one array move the composition editor needs, for chapters
 * and for the entries inside a chapter. Out-of-range moves return the original
 * array, so a refused edge can never duplicate or drop a row.
 */

export function reordered<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return items
  next.splice(to, 0, moved)
  return next
}
