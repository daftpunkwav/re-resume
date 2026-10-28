/**
 * @file overrideTarget
 * @description The two things an override can rewrite: the resume summary, or
 * one entry's body. The type lives on its own so the dialog, its form hook and
 * the composition editor can name it without importing each other.
 */

import type { InfoEntryId, ResumeSectionId } from '../../../domain/shared/branded-id'

export type OverrideTargetSelection =
  | { readonly kind: 'summary' }
  | {
      readonly kind: 'entry'
      readonly entryId: InfoEntryId
      readonly sectionId: ResumeSectionId | null
    }
