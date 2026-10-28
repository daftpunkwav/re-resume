/**
 * @file addCanvasBlock
 * @description Adds one free-positioned block — text, a rule or an image — to a
 * page of the resume. The block is validated against the page it claims and the
 * page must currently exist.
 *
 * Responsibilities:
 * - Allocate the identifier and the top of the z-order
 * - Verify the image attachment exists
 * - Verify the page index is inside the document the layout currently produces
 * - Persist the canvas through `commitResumeChange`
 *
 * Constraints:
 * - A free block is user-positioned absolute content; it never joins the flow.
 * - Page dimensions come from the paper, so the box check needs no layout.
 */

import type { AttachmentId, CanvasBlockId, ResumeId } from '../../domain/shared/branded-id'
import { asCanvasBlockId } from '../../domain/shared/branded-id'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { CanvasBlock, CanvasBlockKind } from '../../domain/resume/CanvasLayout'
import {
  CANVAS_Z_INDEX_MAX,
  assertCanvasBlock,
} from '../../domain/resume/CanvasLayout'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { ChangeProvenance, ResumeContentDeps } from './resumeSource'
import { changeMeta, loadMaterializedResume, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface CanvasBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AddCanvasBlockInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly kind: CanvasBlockKind
  readonly pageIndex: number
  readonly box: CanvasBox
  readonly text?: string | null
  readonly textStyle?: TextStyle | null
  readonly attachmentId?: AttachmentId | null
}

export interface AddCanvasBlockDeps extends ResumeContentDeps {
  readonly attachments: AttachmentRepository
  readonly ids: IdGenerator
}

export interface AddCanvasBlockOutput {
  readonly block: CanvasBlock
  readonly revision: Revision
}

export async function addCanvasBlock(
  deps: AddCanvasBlockDeps,
  input: AddCanvasBlockInput,
): Promise<AddCanvasBlockOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const attachmentId = input.attachmentId ?? null
  if (input.kind === 'image') {
    if (attachmentId === null) {
      throw new DomainError('invalidFieldValue', 'An image block needs an attachment.', {
        entity: 'canvasBlock',
        id: '',
        blockers: ['attachmentId'],
      })
    }
    if ((await deps.attachments.findById(attachmentId)) === null) {
      throw new DomainError('attachmentNotFound', 'The attachment does not exist.', {
        entity: 'canvasBlock',
        id: '',
        blockers: [attachmentId],
      })
    }
  }
  const { layout } = await loadMaterializedResume(deps, resume)
  if (input.pageIndex >= layout.pages.length) {
    throw new DomainError('canvasBlockOutOfBounds', 'The page the block targets does not exist.', {
      entity: 'canvasBlock',
      id: '',
      blockers: [String(input.pageIndex)],
    })
  }
  const block: CanvasBlock = {
    id: asCanvasBlockId(deps.ids.next()) as CanvasBlockId,
    kind: input.kind,
    pageIndex: input.pageIndex,
    x: input.box.x,
    y: input.box.y,
    width: input.box.width,
    height: input.box.height,
    zIndex: nextZIndex(resume.document.canvas.freeBlocks),
    text: input.text ?? null,
    textStyle: input.textStyle ?? null,
    attachmentId,
  }
  assertCanvasBlock(block, resume.document.pageSetup)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('添加画布元素', input),
    next: (state) => ({
      ...state,
      canvas: { freeBlocks: [...state.canvas.freeBlocks, block] },
    }),
  })
  return { block, revision }
}

/** One above the highest existing block, so a new block is drawn on top. */
function nextZIndex(blocks: readonly CanvasBlock[]): number {
  let highest = -1
  for (const block of blocks) highest = Math.max(highest, block.zIndex)
  const next = highest + 1
  if (next > CANVAS_Z_INDEX_MAX) {
    throw new DomainError(
      'invalidFieldValue',
      `The canvas z-index cannot exceed ${CANVAS_Z_INDEX_MAX.toString()}.`,
      { entity: 'canvasBlock', id: '', blockers: [String(next)] },
    )
  }
  return next
}
