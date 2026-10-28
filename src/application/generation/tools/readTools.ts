/**
 * @file readTools
 * @description The eight read tools of the pack: search, entry reads, module and
 * template lists, the resume summary, a posting read and the layout-overflow
 * report. A read tool has no side effect and appears as a neutral card with no
 * undo row.
 *
 * Constraints:
 * - Reads go through the use cases or the read side of a port; they never append
 *   a revision or a change record.
 * - A refusal (for example an unknown identifier) is returned as readable text so
 *   the model can correct the argument instead of failing the run.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import { INFO_MODULE_KINDS } from '../../../domain/info/InfoModuleKind'
import { listInfoEntries } from '../../info/listInfoEntries'
import { searchInfoEntries } from '../../info/searchInfoEntries'
import { checkLayoutOverflow } from '../../resume/checkLayoutOverflow'
import { listTemplates } from '../../../domain/resume/Template'
import {
  asInfoEntryId,
  asJobPostingId,
  asResumeId,
} from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import type { ToolPackDeps } from './deps'
import { infoLibraryDeps, resumeContentDeps } from './deps'
import { buildResumeSummary } from './resumeSummary'
import { defineTool, executeSafely } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

const SEARCH_KEYWORD_MAX_LENGTH = 60
const ENTRY_IDS_MAX = 50

export function createReadTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'searchInfoEntries',
      description: '按关键词检索信息库，返回命中的条目摘要。挑选简历内容前先调用它。',
      risk: 'read',
      schema: z.strictObject({
        keyword: z.string().trim().min(1).max(SEARCH_KEYWORD_MAX_LENGTH),
        moduleKinds: z.array(z.enum(INFO_MODULE_KINDS)).min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: (input, _context: ToolContext) =>
        executeSafely(() => searchInfoEntries(infoLibraryDeps(deps), input)),
    }),
    defineTool({
      name: 'getInfoEntries',
      description: '按标识符读取信息条目的完整字段，用于确认条目细节。',
      risk: 'read',
      schema: z.strictObject({
        entryIds: z.array(z.string().trim().min(1)).min(1).max(ENTRY_IDS_MAX),
      }),
      execute: (input) =>
        executeSafely(async () => {
          const entries = []
          for (const rawId of input.entryIds) {
            const entry = await deps.entries.findById(asInfoEntryId(rawId))
            if (entry === null) {
              throw new DomainError('entryNotFound', `信息条目 ${rawId} 不存在。`, {
                entity: 'infoEntry',
                id: rawId,
                blockers: [rawId],
              })
            }
            entries.push(entry)
          }
          return { entries }
        }),
    }),
    defineTool({
      name: 'listInfoModules',
      description: '列出信息库的模块、每个模块的条目数和自定义模块定义。',
      risk: 'read',
      schema: z.strictObject({}),
      execute: () =>
        executeSafely(async () => {
          const library = await listInfoEntries(infoLibraryDeps(deps), {})
          return { modules: library.summaries, customModules: library.customModules }
        }),
    }),
    defineTool({
      name: 'listResumes',
      description: '列出全部简历的标题、目标岗位、状态与更新时间。',
      risk: 'read',
      schema: z.strictObject({}),
      execute: () =>
        executeSafely(async () => {
          const resumes = await deps.resumes.listAll()
          return {
            resumes: resumes.map((resume) => ({
              resumeId: resume.id,
              title: resume.title,
              targetJob: resume.targetJob,
              status: resume.status,
              updatedAt: resume.updatedAt,
            })),
          }
        }),
    }),
    defineTool({
      name: 'getResume',
      description: '读取一份简历的摘要：章节与已选条目标题、定制文案、缺失引用和自由块数量。',
      risk: 'read',
      schema: z.strictObject({ resumeId: z.string().trim().min(1) }),
      execute: (input) => executeSafely(() => buildResumeSummary(deps, asResumeId(input.resumeId))),
    }),
    defineTool({
      name: 'listTemplates',
      description: '列出可用模板及其支持的栏数与简介。',
      risk: 'read',
      schema: z.strictObject({}),
      execute: () =>
        executeSafely(async () => ({
          templates: listTemplates().map((template) => ({
            templateId: template.id,
            name: template.name,
            description: template.description,
            columns: template.supports.columns,
          })),
        })),
    }),
    defineTool({
      name: 'readJobPosting',
      description: '读取已存储岗位描述的原文、结构化解析结果和图片数量。',
      risk: 'read',
      schema: z.strictObject({ jobPostingId: z.string().trim().min(1) }),
      execute: (input) =>
        executeSafely(async () => {
          const posting = await deps.jobPostings.findById(asJobPostingId(input.jobPostingId))
          if (posting === null) {
            throw new DomainError('invalidFieldValue', `岗位描述 ${input.jobPostingId} 不存在。`, {
              entity: 'jobPosting',
              id: input.jobPostingId,
              blockers: [input.jobPostingId],
            })
          }
          return {
            rawText: posting.rawText,
            parsed: posting.parsed,
            imageCount: posting.imageAttachmentIds.length,
          }
        }),
    }),
    defineTool({
      name: 'checkLayoutOverflow',
      description: '检查简历当前排版：返回页数与溢出条目。写完简历后用它确认排版。',
      risk: 'read',
      schema: z.strictObject({ resumeId: z.string().trim().min(1) }),
      execute: (input) =>
        executeSafely(() =>
          checkLayoutOverflow(resumeContentDeps(deps), {
            resumeId: asResumeId(input.resumeId),
          }),
        ),
    }),
  ]
}
