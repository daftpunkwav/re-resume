/**
 * @file updateCanvasBlockText
 * @description Changes the text of one free canvas block: the inline edit the
 * studio's text editor performs outside the section flows. The edit goes
 * through the same commit point as every other document write, so it validates,
 * labels and undoes like the rest.
 *
 * Constraints:
 * - Only a text block carries editable text; a missing or non-text block is a
 *   domain refusal, not a silent no-op.
 */

import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { CanvasBlockId, ResumeId } from '../../domain/shared/branded-id'
import { commitResumeChange } from './commitResumeChange'
import type { ResumeContentDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export interface UpdateCanvasBlockTextInput {
  readonly resumeId: ResumeId
  readonly blockId: CanvasBlockId
  readonly text: string
}

export async function updateCanvasBlockText(
  deps: ResumeContentDeps,
  input: UpdateCanvasBlockTextInput,
): Promise<Revision> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const block = resume.document.canvas.freeBlocks.find((candidate) => candidate.id === input.blockId)
  if (block === undefined) {
    throw new DomainError('canvasBlockNotFound', 'The canvas block no longer exists.', {
      entity: 'canvasBlock',
      id: input.blockId,
      blockers: [input.blockId],
    })
  }
  if (block.kind !== 'text') {
    throw new DomainError('invalidFieldValue', 'Only a text block carries editable text.', {
      entity: 'canvasBlock',
      id: input.blockId,
      blockers: ['text'],
    })
  }
  return commitResumeChange(deps, input.resumeId, {
    label: '编辑画布文字',
    origin: 'user',
    runId: null,
    next: (state) => ({
      ...state,
      canvas: {
        freeBlocks: state.canvas.freeBlocks.map((candidate) =>
          candidate.id === block.id ? { ...candidate, text: input.text } : candidate,
        ),
      },
    }),
  })
}
