/**
 * @file suggestedPdfFileName
 * @description The file name an export offers to the save dialog: the person,
 * the role they target and the company, in the order a reader expects. The
 * functions are pure so the naming rule can be tested without rendering bytes.
 *
 * Constraints:
 * - Every component is optional; a missing one is skipped rather than printed
 *   as an empty hyphen, and a resume with no components falls back to its title.
 * - The name is a suggestion the user can rewrite in the dialog, so characters
 *   a platform forbids are replaced instead of refusing the export.
 */

import type { Resume } from '../../domain/resume/Resume'

/** Characters no file name can carry on at least one target platform. */
const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|]/gu

/** Longest suggested stem, in code points: 80 CJK characters stay below the 255-byte limit. */
const MAX_STEM_CODE_POINTS = 80

const FALLBACK_STEM = '简历'

/**
 * Composes `<name>-<role>-<company>.pdf`, falling back to the resume title and
 * then to a generic stem.
 */
export function suggestedPdfFileName(resume: Resume, headerName: string | null): string {
  const parts = [
    headerName,
    resume.targetJob?.title ?? null,
    resume.targetJob?.company ?? null,
  ]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
  return `${fileStem(parts.length > 0 ? parts.join('-') : resume.title)}.pdf`
}

function fileStem(raw: string): string {
  const withoutControl = [...raw]
    .map((char) => ((char.codePointAt(0) ?? 0) < 0x20 ? ' ' : char))
    .join('')
  const cleaned = withoutControl.replace(FORBIDDEN_NAME_CHARS, ' ').replace(/\s+/gu, ' ').trim()
  // Windows rejects a trailing dot or space and strips both silently.
  const trimmed = cleaned.replace(/[. ]+$/gu, '')
  const stem = [...trimmed].slice(0, MAX_STEM_CODE_POINTS).join('').trim()
  return stem === '' ? FALLBACK_STEM : stem
}
