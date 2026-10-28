/**
 * @file resumeTools
 * @description The resume-writing tools: create a resume, edit its metadata, and
 * change the document (selection, order, chapter display, template, appearance,
 * page). Every document write goes through the use case that commits one
 * revision, so the tool result names the revision the card can undo.
 *
 * Constraints:
 * - Metadata (title, target job) is written directly by its use case and is not
 *   reversible from history; the tool says so in the operation rules.
 * - A document write always names this run; the revision chain records the
 *   agent as the author, which is what the card-level undo checks.
 * - Every result carries `resumeId` beside `revisionId`, so the audit row and the
 *   undo button can name the resume without a second read.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import {
  ACCENT_COLORS,
  HEADING_STYLES,
} from '../../../domain/resume/AppearanceSettings'
import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import { PAPER_SIZES } from '../../../domain/resume/PageSetup'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import { INFO_MODULE_KINDS } from '../../../domain/info/InfoModuleKind'
import {
  asCustomModuleId,
  asInfoEntryId,
  asJobPostingId,
  asResumeId,
  asResumeSectionId,
  asTemplateId,
} from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { createResume } from '../../resume/createResume'
import { renameResume } from '../../resume/renameResume'
import { setAppearance } from '../../resume/setAppearance'
import { setPageSetup } from '../../resume/setPageSetup'
import { setSectionDisplay } from '../../resume/setSectionDisplay'
import { setSectionOrder } from '../../resume/setSectionOrder'
import { setSectionSelection } from '../../resume/setSectionSelection'
import { setTemplate } from '../../resume/setTemplate'
import { updateResumeTarget } from '../../resume/updateResumeTarget'
import type { ToolPackDeps } from './deps'
import { defineTool, executeSafely, resumeProvenance } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

const selectionSchema = z.strictObject({
  moduleKind: z.enum(INFO_MODULE_KINDS),
  customModuleId: z.string().trim().min(1).nullable().optional(),
  entryIds: z.array(z.string().trim().min(1)).max(50),
})

const targetJobSchema = z.strictObject({
  title: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(80).nullable().optional(),
  jobPostingId: z.string().trim().min(1).nullable().optional(),
})

export function createResumeTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'createResume',
      description:
        '创建一份新简历并选择初始条目。创建后可用章节工具继续调整；创建本身不可撤销，需要删除请让用户在简历列表操作。',
      risk: 'write',
      schema: z.strictObject({
        title: z.string().trim().min(1).max(80),
        targetJob: targetJobSchema.nullable().optional(),
        templateId: z.string().trim().min(1).optional(),
        selection: z.array(selectionSchema).max(20).optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const created = await createResume(
            {
              resumes: deps.resumes,
              entries: deps.entries,
              ids: deps.ids,
              clock: deps.clock,
            },
            {
              title: input.title,
              targetJob:
                input.targetJob === null || input.targetJob === undefined
                  ? null
                  : {
                      title: input.targetJob.title ?? null,
                      company: input.targetJob.company ?? null,
                      jobPostingId:
                        input.targetJob.jobPostingId === null ||
                        input.targetJob.jobPostingId === undefined
                          ? null
                          : asJobPostingId(input.targetJob.jobPostingId),
                    },
              templateId:
                input.templateId === undefined ? undefined : asTemplateId(input.templateId),
              conversationId: context.conversationId,
              initialSelection: (input.selection ?? []).map((selection) => ({
                moduleKind: selection.moduleKind,
                customModuleId:
                  selection.customModuleId === null ||
                  selection.customModuleId === undefined
                    ? null
                    : asCustomModuleId(selection.customModuleId),
                entryIds: selection.entryIds.map((entryId) => asInfoEntryId(entryId)),
              })),
              ...resumeProvenance(context),
            },
          )
          return { resumeId: created.resumeId, revisionId: created.revisionId }
        }),
    }),
    defineTool({
      name: 'updateResume',
      description:
        '修改简历的标题或目标岗位。这属于元数据，不进入撤销历史，卡片会标注不可撤销。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        title: z.string().trim().min(1).max(80).optional(),
        targetJob: targetJobSchema.nullable().optional(),
      }),
      execute: (input) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          if (input.title === undefined && input.targetJob === undefined) {
            throw new DomainError('blankRequiredField', '至少提供一个要修改的字段。', {
              entity: 'resume',
              id: input.resumeId,
              blockers: ['title'],
            })
          }
          if (input.title !== undefined) {
            await renameResume({ resumes: deps.resumes, clock: deps.clock }, { resumeId, title: input.title })
          }
          if (input.targetJob !== undefined) {
            await updateResumeTarget(
              { resumes: deps.resumes, clock: deps.clock },
              {
                resumeId,
                targetJob:
                  input.targetJob === null
                    ? null
                    : {
                        title: input.targetJob.title ?? null,
                        company: input.targetJob.company ?? null,
                        jobPostingId:
                          input.targetJob.jobPostingId === null ||
                          input.targetJob.jobPostingId === undefined
                            ? null
                            : asJobPostingId(input.targetJob.jobPostingId),
                      },
              },
            )
          }
          return { resumeId, reversible: false }
        }),
    }),
    defineTool({
      name: 'setSectionSelection',
      description:
        '选择某个章节要渲染的信息条目（按给定顺序）。章节不存在时会在规范位置创建。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        moduleKind: z.enum(INFO_MODULE_KINDS),
        customModuleId: z.string().trim().min(1).nullable().optional(),
        entryIds: z.array(z.string().trim().min(1)).max(50),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await setSectionSelection(
            { resumes: deps.resumes, entries: deps.entries, ids: deps.ids },
            {
              resumeId,
              moduleKind: input.moduleKind,
              customModuleId:
                input.customModuleId === null || input.customModuleId === undefined
                  ? null
                  : asCustomModuleId(input.customModuleId),
              entryIds: input.entryIds.map((entryId) => asInfoEntryId(entryId)),
              ...resumeProvenance(context),
            },
          )
          return { resumeId, sectionId: result.sectionId, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'setSectionOrder',
      description: '调整简历章节顺序。必须列出当前简历的全部章节标识。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        orderedSectionIds: z.array(z.string().trim().min(1)).min(1),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await setSectionOrder(
            { resumes: deps.resumes },
            {
              resumeId,
              orderedSectionIds: input.orderedSectionIds.map((sectionId) =>
                asResumeSectionId(sectionId),
              ),
              ...resumeProvenance(context),
            },
          )
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'setSectionDisplay',
      description: '修改章节的显示名称、是否可见或所在栏位。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        sectionId: z.string().trim().min(1),
        displayName: z.string().trim().min(1).max(24).nullable().optional(),
        visible: z.boolean().optional(),
        column: z.union([z.literal(1), z.literal(2)]).optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          if (
            input.displayName === undefined &&
            input.visible === undefined &&
            input.column === undefined
          ) {
            throw new DomainError('blankRequiredField', '至少提供一个要修改的章节字段。', {
              entity: 'resumeSection',
              id: input.sectionId,
              blockers: ['sectionId'],
            })
          }
          const result = await setSectionDisplay(
            { resumes: deps.resumes },
            {
              resumeId,
              sectionId: asResumeSectionId(input.sectionId),
              displayName: input.displayName,
              visible: input.visible,
              column: input.column,
              ...resumeProvenance(context),
            },
          )
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'setTemplate',
      description: '切换简历模板。章节与内容保留，外观与页面取新模板默认值。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        templateId: z.string().trim().min(1),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await setTemplate(
            { resumes: deps.resumes },
            {
              resumeId,
              templateId: asTemplateId(input.templateId),
              ...resumeProvenance(context),
            },
          )
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'setAppearance',
      description: '调整简历外观：强调色、字号缩放、行高、章节间距与标题样式。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        accentColor: z.enum(ACCENT_COLORS).optional(),
        fontScale: z.number().min(0.85).max(1.25).optional(),
        lineHeight: z.number().min(1.15).max(2).optional(),
        sectionSpacing: z.number().min(8).max(48).optional(),
        headingStyle: z.enum(HEADING_STYLES).optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const patch: Partial<AppearanceSettings> = {
            ...(input.accentColor === undefined ? {} : { accentColor: input.accentColor }),
            ...(input.fontScale === undefined ? {} : { fontScale: input.fontScale }),
            ...(input.lineHeight === undefined ? {} : { lineHeight: input.lineHeight }),
            ...(input.sectionSpacing === undefined
              ? {}
              : { sectionSpacing: input.sectionSpacing }),
            ...(input.headingStyle === undefined ? {} : { headingStyle: input.headingStyle }),
          }
          if (Object.keys(patch).length === 0) {
            throw new DomainError('blankRequiredField', '至少提供一个要修改的外观字段。', {
              entity: 'resume',
              id: input.resumeId,
              blockers: ['accentColor'],
            })
          }
          const result = await setAppearance(
            { resumes: deps.resumes },
            { resumeId, patch, ...resumeProvenance(context) },
          )
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
    defineTool({
      name: 'setPageSetup',
      description: '调整简历页面：纸型、四边距、栏数与页码。',
      risk: 'write',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        paper: z.enum(PAPER_SIZES).optional(),
        marginTop: z.number().min(24).max(144).optional(),
        marginRight: z.number().min(24).max(144).optional(),
        marginBottom: z.number().min(24).max(144).optional(),
        marginLeft: z.number().min(24).max(144).optional(),
        columns: z.union([z.literal(1), z.literal(2)]).optional(),
        showPageNumber: z.boolean().optional(),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const patch: Partial<PageSetup> = {
            ...(input.paper === undefined ? {} : { paper: input.paper }),
            ...(input.marginTop === undefined ? {} : { marginTop: input.marginTop }),
            ...(input.marginRight === undefined ? {} : { marginRight: input.marginRight }),
            ...(input.marginBottom === undefined ? {} : { marginBottom: input.marginBottom }),
            ...(input.marginLeft === undefined ? {} : { marginLeft: input.marginLeft }),
            ...(input.columns === undefined ? {} : { columns: input.columns }),
            ...(input.showPageNumber === undefined
              ? {}
              : { showPageNumber: input.showPageNumber }),
          }
          if (Object.keys(patch).length === 0) {
            throw new DomainError('blankRequiredField', '至少提供一个要修改的页面字段。', {
              entity: 'resume',
              id: input.resumeId,
              blockers: ['paper'],
            })
          }
          const result = await setPageSetup(
            { resumes: deps.resumes },
            { resumeId, patch, ...resumeProvenance(context) },
          )
          return { resumeId, revisionId: result.revision.id }
        }),
    }),
  ]
}
