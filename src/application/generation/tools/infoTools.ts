/**
 * @file infoTools
 * @description The library-writing tools: analyze a posting, create or update an
 * information entry, and define a custom module. Each one delegates to the
 * information-library use cases and reports the change record so the card can
 * offer undo.
 *
 * Constraints:
 * - Every write is attributed to the conversation and the run: the use case
 *   refuses an agent write without a run, and the tool always supplies one.
 * - Free text enters the library only through field values (or a custom module
 *   label); no tool here writes a resume.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import { INFO_MODULE_KINDS } from '../../../domain/info/InfoModuleKind'
import {
  asAttachmentId,
  asCustomModuleId,
  asInfoEntryId,
} from '../../../domain/shared/branded-id'
import { createCustomModule } from '../../info/createCustomModule'
import { createInfoEntry } from '../../info/createInfoEntry'
import { updateInfoEntry } from '../../info/updateInfoEntry'
import type { ToolPackDeps } from './deps'
import { infoLibraryDeps } from './deps'
import { JOB_DESCRIPTION_MAX_LENGTH, analyzeJobDescription } from './jobPostingTools'
import { agentProvenance, defineTool, executeSafely } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

/** Field values accepted from the model: text, a flag, or an explicit null. */
const fieldValueSchema = z.union([z.string(), z.boolean(), z.null()])

const customFieldSchema = z.strictObject({
  label: z.string().trim().min(1).max(20),
  type: z.enum(['text', 'textarea']),
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(2000),
})

export function createInfoTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'analyzeJobDescription',
      description:
        '分析岗位描述（粘贴文本或附件），保存岗位并提取结构化要求。收到用户给的岗位描述时先调用它。',
      risk: 'write',
      schema: z.strictObject({
        text: z.string().min(1).max(JOB_DESCRIPTION_MAX_LENGTH).optional(),
        attachmentId: z.string().trim().min(1).optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(() =>
          analyzeJobDescription(deps, context, {
            text: input.text,
            attachmentId:
              input.attachmentId === undefined
                ? undefined
                : asAttachmentId(input.attachmentId),
          }),
        ),
    }),
    defineTool({
      name: 'createInfoEntry',
      description: '在信息库中新增一条事实记录。只在用户确认要保存新经历、项目或技能时调用。',
      risk: 'write',
      schema: z.strictObject({
        moduleKind: z.enum(INFO_MODULE_KINDS),
        customModuleId: z.string().trim().min(1).nullable().optional(),
        fields: z.record(z.string(), fieldValueSchema),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const provenance = agentProvenance(context)
          const created = await createInfoEntry(infoLibraryDeps(deps), {
            moduleKind: input.moduleKind,
            customModuleId:
              input.customModuleId === null || input.customModuleId === undefined
                ? null
                : asCustomModuleId(input.customModuleId),
            fields: input.fields,
            origin: provenance.origin,
            sourceRunId: provenance.runId,
            conversationId: provenance.conversationId,
          })
          return {
            entryId: created.entry.id,
            title: created.entry.title,
            changeId: created.change.id,
          }
        }),
    }),
    defineTool({
      name: 'updateInfoEntry',
      description: '整体替换一条信息记录的字段。缺省的可选字段会被写为空，不是保留旧值。',
      risk: 'write',
      schema: z.strictObject({
        entryId: z.string().trim().min(1),
        fields: z.record(z.string(), fieldValueSchema),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const provenance = agentProvenance(context)
          const updated = await updateInfoEntry(infoLibraryDeps(deps), {
            entryId: asInfoEntryId(input.entryId),
            fields: input.fields,
            origin: provenance.origin,
            sourceRunId: provenance.runId,
            conversationId: provenance.conversationId,
          })
          return { entryId: updated.entry.id, changeId: updated.change.id }
        }),
    }),
    defineTool({
      name: 'createCustomModule',
      description: '新建一个自定义信息模块及其字段定义。',
      risk: 'write',
      schema: z.strictObject({
        name: z.string().trim().min(1).max(20),
        fields: z.array(customFieldSchema).min(1).max(12),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const provenance = agentProvenance(context)
          const created = await createCustomModule(infoLibraryDeps(deps), {
            name: input.name,
            fields: input.fields.map((field) => ({
              label: field.label,
              type: field.type,
              required: field.required,
              maxLength: field.maxLength,
            })),
            origin: provenance.origin,
            sourceRunId: provenance.runId,
            conversationId: provenance.conversationId,
          })
          return { moduleId: created.module.id, changeId: created.change.id }
        }),
    }),
  ]
}
