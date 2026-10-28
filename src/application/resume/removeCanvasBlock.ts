/**
 * @file removeCanvasBlock
 * @description Removes one free-positioned block from the canvas. The block's
 * content leaves the document with it; undo restores both because the whole
 * previous state is in the revision chain.
 *
 * Constraints:
 * - Deliberately not exposed as an agent tool: the agent has no delete tools
 *   (spec section 7.10).
 */

import type { CanvasBlockId, ResumeId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface RemoveCanvasBlockInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly blockId: CanvasBlockId
}

export interface RemoveCanvasBlockOutput {
  readonly revision: Revision
}

export async function removeCanvasBlock(
  deps: ResumeStoreDeps,
  input: RemoveCanvasBlockInput,
): Promise<RemoveCanvasBlockOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const exists = resume.document.canvas.freeBlocks.some((block) => block.id === input.blockId)
  if (!exists) {
    throw new DomainError('canvasBlockNotFound', 'The canvas block does not exist.', {
      entity: 'canvasBlock',
      id: input.blockId,
      blockers: [input.blockId],
    })
  }
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('删除画布元素', input),
    next: (state) => ({
      ...state,
      canvas: {
        freeBlocks: state.canvas.freeBlocks.filter((block) => block.id !== input.blockId),
      },
    }),
  })
  return { revision }
}
