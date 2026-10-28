/**
 * @file resizeCanvasBlock
 * @description Resizes one free-positioned block. The new box is validated
 * against the page: at least the minimum extent and still inside the paper.
 *
 * Constraints:
 * - Only the size changes; position, content and z-order stay.
 */

import type { CanvasBlockId, ResumeId } from '../../domain/shared/branded-id'
import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import { assertCanvasBlock } from '../../domain/resume/CanvasLayout'
import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface ResizeCanvasBlockInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly blockId: CanvasBlockId
  readonly width: number
  readonly height: number
}

export interface ResizeCanvasBlockOutput {
  readonly block: CanvasBlock
  readonly revision: Revision
}

export async function resizeCanvasBlock(
  deps: ResumeStoreDeps,
  input: ResizeCanvasBlockInput,
): Promise<ResizeCanvasBlockOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const block = requireBlock(resume.document.canvas.freeBlocks, input.blockId)
  const resized: CanvasBlock = { ...block, width: input.width, height: input.height }
  assertCanvasBlock(resized, resume.document.pageSetup)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('调整画布元素大小', input),
    next: (state) => ({
      ...state,
      canvas: {
        freeBlocks: state.canvas.freeBlocks.map((candidate) =>
          candidate.id === resized.id ? resized : candidate,
        ),
      },
    }),
  })
  return { block: resized, revision }
}

function requireBlock(blocks: readonly CanvasBlock[], blockId: CanvasBlockId): CanvasBlock {
  const block = blocks.find((candidate) => candidate.id === blockId)
  if (block === undefined) {
    throw new DomainError('canvasBlockNotFound', 'The canvas block does not exist.', {
      entity: 'canvasBlock',
      id: blockId,
      blockers: [blockId],
    })
  }
  return block
}
