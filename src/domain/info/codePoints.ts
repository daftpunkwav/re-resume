/**
 * @file codePoints
 * @description Length and truncation helpers that count Unicode code points
 * rather than UTF-16 code units. A maximum length stated in the contract means
 * characters as a reader counts them, so an emoji or a CJK extension character
 * has to cost one, not two.
 *
 * Constraints:
 * - Counting is done by iteration, which walks code points, not by `length`.
 * - Truncation never splits a surrogate pair.
 */

/** Number of Unicode code points in the text. */
export function countCodePoints(text: string): number {
  let count = 0
  for (const _ of text) count += 1
  return count
}

/**
 * First `limit` code points of the text. Text at or below the limit is
 * returned unchanged; a truncated value gets an ellipsis, so a caller cannot
 * mistake it for the whole value.
 */
export function truncateCodePoints(text: string, limit: number): string {
  const points = [...text]
  if (points.length <= limit) return text
  return `${points.slice(0, limit).join('')}…`
}
