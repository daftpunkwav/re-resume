/**
 * @file canvasTools
 * @description The free-placement tools: add one text, divider or image block to
 * a page of the resume, and move an existing block. Both commit one revision
 * through the canvas use cases, which validate the page, the box and the content
 * rules before anything is written.
 *
 * Constraints:
 * - The attachment must already exist; the tool does not upload bytes.
 * - A block is placed inside the physical page, not the content box: a user may
 *   place content into the margin on purpose and the layout reports it.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import { CANVAS_Z_INDEX_MAX } from '../../../domain/resume/CanvasLayout'
import type { TextStyle } from '../../../domain/resume/TextStyle'
import {
  asAttachmentId,
  asCanvasBlockId,
  asResumeId,
} from '../../../domain/shared/branded-id'
import { addCanvasBlock } from '../../resume/addCanvasBlock'
import { moveCanvasBlock } from '../../resume/moveCanvasBlock'
import type { ToolPackDeps } from './deps'
import { resumeContentDeps } from './deps'
import { defineTool, executeSafely, resumeProvenance } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

const boxSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(8),
  height: z.number().finite().min(8),
})

const textStyleSchema = z.strictObject({
  fontFamily: z.string().trim().min(1),
  fontSize: z.number().finite().positive(),
  fontWeight: z.number().int().positive(),
  lineHeight: z.number().finite().positive(),
})

export function createCanvasTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'addCanvasBlock',
      description: '在简历某页添加自由定位的文本、分隔线或图片块。坐标与尺寸单位为 pt。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        kind: z.enum(['text', 'divider', 'image']),
        pageIndex: z.number().int().min(0),
        box: boxSchema,
        text: z.string().max(4000).nullable().optional(),
        attachmentId: z.string().trim().min(1).nullable().optional(),
        textStyle: textStyleSchema.nullable().optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await addCanvasBlock(
            {
              ...resumeContentDeps(deps),
              attachments: deps.attachments,
              ids: deps.ids,
            },
            {
              resumeId,
              kind: input.kind,
              pageIndex: input.pageIndex,
              box: input.box,
              text: input.text ?? null,
              attachmentId:
                input.attachmentId === null || input.attachmentId === undefined
                  ? null
                  : asAttachmentId(input.attachmentId),
              textStyle:
                input.textStyle === null || input.textStyle === undefined
                  ? null
                  : (input.textStyle as TextStyle),
              ...resumeProvenance(context),
            },
          )
          return { resumeId, blockId: result.block.id, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'moveCanvasBlock',
      description: '移动简历中已有的自由块到新的位置、页面或层级。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
        pageIndex: z.number().int().min(0).optional(),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        zIndex: z.number().int().min(0).max(CANVAS_Z_INDEX_MAX).optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await moveCanvasBlock(resumeContentDeps(deps), {
            resumeId,
            blockId: asCanvasBlockId(input.blockId),
            pageIndex: input.pageIndex,
            x: input.x,
            y: input.y,
            zIndex: input.zIndex,
            ...resumeProvenance(context),
          })
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
  ]
}
