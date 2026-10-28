/**
 * @file exportTools
 * @description The one export tool of the pack: it renders a resume to PDF and
 * asks the user where to save it through the system dialog.
 *
 * Constraints:
 * - The tool never writes a file silently: the saver owns the dialog, and a
 *   dismissed dialog is reported as a cancellation rather than a failure.
 * - The export is read-only for the resume. It records no revision and no
 *   change record, so it never enters the undo chain.
 * - Domain refusals (missing resume, empty document, frozen without snapshot)
 *   are returned as the tool failure the model can read; environment faults
 *   surface as faults rather than as a successful result.
 */

import { z } from 'zod'

import { asResumeId } from '../../../domain/shared/branded-id'
import { exportPdf } from '../../export/exportPdf'
import type { ToolPackDeps } from './deps'
import { pdfExportDeps } from './deps'
import { defineTool, executeSafely } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

export function createExportTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'exportPdf',
      description:
        '将简历导出为 PDF 并打开系统保存对话框。草稿导出当前文档，定稿导出冻结快照；返回保存路径或取消结果。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
      }),
      execute: (input) =>
        executeSafely(async () => {
          const result = await exportPdf(pdfExportDeps(deps), {
            resumeId: asResumeId(input.resumeId),
          })
          return {
            savedPath: result.savedPath,
            cancelled: result.savedPath === null,
            suggestedFileName: result.suggestedFileName,
            pageCount: result.pageCount,
            frozen: result.frozen,
            overflows: result.overflows.length,
            warnings: result.warnings,
          }
        }),
    }),
  ]
}
