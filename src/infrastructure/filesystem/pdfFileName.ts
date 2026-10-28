/**
 * @file pdfFileName
 * @description The file-name rules both PDF savers share: a suggested name is a
 * convenience, so characters a platform forbids are replaced rather than
 * rejecting the export. The dialog still lets the user rewrite the result.
 *
 * Constraints:
 * - Test support and production both call this, so the two save paths cannot
 *   diverge on which names one of them accepts.
 */

/** Characters no file name can carry on at least one target platform. */
const FORBIDDEN_NAME_CHARS = /[/\\:?*"<>|]/gu

/** Longest suggested stem, in code points: 80 CJK characters stay below the 255-byte limit. */
const MAX_STEM_CODE_POINTS = 80

const FALLBACK_STEM = '简历'

export function sanitizePdfFileName(suggestedName: string): string {
  const stem = suggestedName.replace(/\.pdf$/iu, '')
  const withoutControl = [...stem]
    .map((char) => ((char.codePointAt(0) ?? 0) < 0x20 ? ' ' : char))
    .join('')
  const cleaned = withoutControl.replace(FORBIDDEN_NAME_CHARS, ' ').replace(/\s+/gu, ' ').trim()
  // Windows rejects a trailing dot or space and strips both silently.
  const trimmed = cleaned.replace(/[. ]+$/gu, '')
  const bounded = [...trimmed].slice(0, MAX_STEM_CODE_POINTS).join('').trim()
  return `${bounded === '' ? FALLBACK_STEM : bounded}.pdf`
}
