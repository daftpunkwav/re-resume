/**
 * @file readMaterializedDocument
 * @description The query the interface uses to draw a resume: the materialized
 * blocks, the missing references and the page count the current layout produces.
 * The interface must not assemble resume content itself; this is the one read
 * that hands it the content (spec section 5.16).
 *
 * Constraints:
 * - Read-only: no revision, no change record.
 * - The page count is recomputed from the same blocks the canvas will draw.
 */

import type { LayoutBlock } from '../../domain/resume/Layout'
import type { MissingReference } from '../../domain/resume/MissingReference'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ResumeContentDeps } from './resumeSource'
import { loadMaterializedResume, loadResume } from './resumeSource'

export interface ReadMaterializedDocumentInput {
  readonly resumeId: ResumeId
}

export interface ReadMaterializedDocumentOutput {
  readonly blocks: readonly LayoutBlock[]
  readonly missingReferences: readonly MissingReference[]
  readonly pageCount: number
}

/**
 * Implements the materialization query of spec section 5.16. The pure builder in
 * `materializeDocument.ts` produces the blocks; this function owns the read.
 */
export async function readMaterializedDocument(
  deps: ResumeContentDeps,
  input: ReadMaterializedDocumentInput,
): Promise<ReadMaterializedDocumentOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const materialized = await loadMaterializedResume(deps, resume)
  return {
    blocks: materialized.document.blocks,
    missingReferences: materialized.document.missingReferences,
    pageCount: materialized.layout.pages.length,
  }
}
