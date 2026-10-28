/**
 * @file moveCanvasBlock
 * @description Moves one free-positioned block to a page position or changes its
 * paint order. The moved block is re-validated against the page it lands on, and
 * a page index must still exist in the current layout.
 *
 * Constraints:
 * - The block keeps its identifier and content; just one revision is produced.
 */

import type { CanvasBlockId, ResumeId } from '../../domain/shared/branded-id'
import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import { assertCanvasBlock } from '../../domain/resume/CanvasLayout'
import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeContentDeps } from './resumeSource'
import { changeMeta, loadMaterializedResume, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface MoveCanvasBlockInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly blockId: CanvasBlockId
  readonly pageIndex?: number
  readonly x?: number
  readonly y?: number
  readonly zIndex?: number
}

export type MoveCanvasBlockDeps = ResumeContentDeps

export interface MoveCanvasBlockOutput {
  readonly block: CanvasBlock
  readonly revision: Revision
}

export async function moveCanvasBlock(
  deps: MoveCanvasBlockDeps,
  input: MoveCanvasBlockInput,
): Promise<MoveCanvasBlockOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const block = requireBlock(resume.document.canvas.freeBlocks, input.blockId)
  const moved: CanvasBlock = {
    ...block,
    pageIndex: input.pageIndex ?? block.pageIndex,
    x: input.x ?? block.x,
    y: input.y ?? block.y,
    zIndex: input.zIndex ?? block.zIndex,
  }
  if (moved.pageIndex !== block.pageIndex) {
    const { layout } = await loadMaterializedResume(deps, resume)
    if (moved.pageIndex >= layout.pages.length) {
      throw new DomainError(
        'canvasBlockOutOfBounds',
        'The page the block targets does not exist.',
        { entity: 'canvasBlock', id: block.id, blockers: [String(moved.pageIndex)] },
      )
    }
  }
  assertCanvasBlock(moved, resume.document.pageSetup)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('移动画布元素', input),
    next: (state) => ({
      ...state,
      canvas: {
        freeBlocks: state.canvas.freeBlocks.map((candidate) =>
          candidate.id === moved.id ? moved : candidate,
        ),
      },
    }),
  })
  return { block: moved, revision }
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
