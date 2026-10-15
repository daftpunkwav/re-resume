/**
 * @file layout-metrics
 * @description Pure character classification for line breaking: where a line may
 * end. It needs no font metrics, so it stays outside the TextMeasurer port —
 * on the port, every test double would reimplement the same rules and a shared
 * mistake would still pass.
 *
 * Responsibilities:
 * - Report UAX #14 break opportunities for Latin text and CJK text
 * - Apply kinsoku: a line may not open with closing punctuation and may not end
 *   with opening punctuation
 *
 * Constraints:
 * - Offsets are indices into the original string, so a caller can slice with
 *   them directly. Surrogate pairs count as one character.
 */

/** Kinsoku: these may not begin a line; they move down with the character before. */
const CHARACTERS_FORBIDDEN_AT_LINE_START: ReadonlySet<string> = new Set([
  ...'，。、；：？！」』）',
])

/** Kinsoku: these may not end a line. */
const CHARACTERS_FORBIDDEN_AT_LINE_END: ReadonlySet<string> = new Set([...'（「『'])

const HYPHEN = '-'

interface CharacterUnit {
  readonly char: string
  /** Index of this character in the source string. */
  readonly start: number
}

export function findBreakOpportunities(text: string): readonly number[] {
  const units = characterUnits(text)
  const opportunities: number[] = []
  let previous = units[0]
  for (let index = 1; index < units.length; index += 1) {
    const current = units[index]
    if (previous === undefined || current === undefined) break
    if (isBreakOpportunity(previous.char, current.char)) opportunities.push(current.start)
    previous = current
  }
  return opportunities
}

function isBreakOpportunity(previous: string, current: string): boolean {
  // Kinsoku is decided first: neither rule below may re-open a forbidden pair.
  if (CHARACTERS_FORBIDDEN_AT_LINE_START.has(current)) return false
  if (CHARACTERS_FORBIDDEN_AT_LINE_END.has(previous)) return false
  // Trailing spaces stay with the line they belong to.
  if (isWhitespace(current)) return false
  if (isWhitespace(previous) || previous === HYPHEN) return true
  // CJK breaks between characters and at a script boundary; a Latin word holds
  // together.
  return isCjk(previous) || isCjk(current)
}

function characterUnits(text: string): readonly CharacterUnit[] {
  const units: CharacterUnit[] = []
  let start = 0
  // Iterating a string yields code points, so an astral character stays whole.
  for (const char of text) {
    units.push({ char, start })
    start += char.length
  }
  return units
}

function isWhitespace(char: string): boolean {
  return char.trim() === ''
}

/** CJK ideographs, kana, CJK punctuation and the fullwidth forms. */
function isCjk(char: string): boolean {
  const codePoint = char.codePointAt(0)
  if (codePoint === undefined) return false
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60)
  )
}
