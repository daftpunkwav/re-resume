/**
 * @file contextBlocks
 * @description Renders the two structured context blocks the prompt carries: the
 * current resume summary and the information-library overview. Both are fitted to
 * their own token budget before the generic assembler sees them, using the
 * trimming order the technical contract fixes.
 *
 * Responsibilities:
 * - Render a resume summary, dropping selected titles first and shortening
 *   tailored overrides second (spec section 7.5)
 * - Render a library overview with per-module counts and titles, trimming from
 *   the last module backwards and keeping at least five titles per module
 * - State every cut in the rendered text, so the prompt never claims to be
 *   complete when it is not
 *
 * Constraints:
 * - The budget arithmetic is the shared estimator from `context.ts`; this module
 *   does not carry a second token model.
 * - Pure formatting over already-read values: no repository access here.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import {
  BUILT_IN_MODULE_KINDS,
  moduleDescriptor,
} from '../../../domain/info/InfoModuleKind'
import { getTemplate } from '../../../domain/resume/Template'
import { CONTEXT_BLOCK_TOKEN_BUDGET, estimateTokens } from '../context'
import type { ResumeSummary } from './resumeSummary'

/** How many titles one module contributes to the overview. */
export const LIBRARY_OVERVIEW_TITLES_PER_MODULE = 30

/** The floor the trimming order keeps for every module. */
export const LIBRARY_OVERVIEW_MIN_TITLES = 5

/** Longest tailored override text kept when the summary block has to shrink. */
export const RESUME_SUMMARY_OVERRIDE_LIMIT = 120

/** Tokens reserved for the note a trimmed block appends after fitting. */
const TRIM_NOTE_TOKEN_ALLOWANCE = 40

interface SummaryRenderOptions {
  readonly includeTitles: boolean
  readonly overrideLimit: number | null
}

/**
 * Fits the resume summary into its block budget. The order is contractual:
 * first the selected entry titles go, then the tailored overrides shrink to 120
 * characters.
 */
export function buildResumeContextBlock(summary: ResumeSummary): string {
  const budget = CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary
  const full = renderResumeSummary(summary, { includeTitles: true, overrideLimit: null })
  if (estimateTokens(full) <= budget) return full
  const withoutTitles = renderResumeSummary(summary, {
    includeTitles: false,
    overrideLimit: null,
  })
  if (estimateTokens(withoutTitles) + TRIM_NOTE_TOKEN_ALLOWANCE <= budget) {
    return `${withoutTitles}\n（已省略部分已选条目标题以满足长度限制。）`
  }
  const compact = renderResumeSummary(summary, {
    includeTitles: false,
    overrideLimit: RESUME_SUMMARY_OVERRIDE_LIMIT,
  })
  return `${compact}\n（已省略部分已选条目标题，并截断定制文案到 ${RESUME_SUMMARY_OVERRIDE_LIMIT.toString()} 字。）`
}

function renderResumeSummary(
  summary: ResumeSummary,
  options: SummaryRenderOptions,
): string {
  const template = getTemplate(summary.templateId)
  const lines: string[] = [
    `简历：${summary.title}（${summary.status === 'frozen' ? '已冻结' : '草稿'}）`,
    `目标岗位：${describeTargetJob(summary)}`,
    `模板：${template?.name ?? summary.templateId}`,
    `页面：${summary.pageSetup.paper}，${summary.pageSetup.columns === 1 ? '单栏' : '双栏'}，页码${summary.pageSetup.showPageNumber ? '开启' : '关闭'}`,
    `缺失引用：${summary.missingReferences.length.toString()} 项；自由块：${summary.freeBlockCount.toString()} 个`,
  ]
  if (summary.sections.length === 0) {
    lines.push('章节：无')
  } else {
    lines.push('章节：')
    const titlesBySection = new Map(
      summary.selectedEntryTitles.map((entry) => [entry.sectionId, entry.titles]),
    )
    for (const section of summary.sections) {
      const name = sectionName(summary, section.sectionId) ?? section.moduleKind
      const titles = titlesBySection.get(section.sectionId) ?? []
      const suffix = section.visible ? '' : '，隐藏'
      const titleText =
        options.includeTitles && titles.length > 0 ? `：${titles.join('、')}` : ''
      lines.push(`- ${name}（${section.entryIds.length.toString()} 条${suffix}）${titleText}`)
    }
  }
  if (summary.overrides.length > 0) {
    lines.push('定制文案：')
    for (const override of summary.overrides) {
      const target =
        override.target.kind === 'summary' ? '岗位总结' : `条目 ${override.target.entryId}`
      const origin = override.origin === 'agent' ? 'Agent 生成' : '用户撰写'
      const text =
        options.overrideLimit === null
          ? override.text
          : truncateCodePoints(override.text, options.overrideLimit)
      lines.push(`- ${target}（${origin}${override.editedByUser ? '，已人工修改' : ''}）：${text}`)
    }
  }
  return lines.join('\n')
}

function sectionName(
  summary: ResumeSummary,
  sectionId: ResumeSummary['sections'][number]['sectionId'],
): string | null {
  const section = summary.sections.find((candidate) => candidate.sectionId === sectionId)
  if (section === undefined) return null
  if (section.displayName !== null) return section.displayName
  if (section.moduleKind === 'custom') return '自定义模块'
  return moduleDescriptor(section.moduleKind, null).defaultSectionName
}

function describeTargetJob(summary: ResumeSummary): string {
  const target = summary.targetJob
  if (target === null) return '未指定'
  const parts = [target.title, target.company].filter((part): part is string => part !== null)
  return parts.length === 0 ? '未指定' : parts.join(' · ')
}

/**
 * Renders the library overview: one line per module with its count and up to
 * thirty titles, trimmed from the last module backwards down to five titles
 * each, then by dropping whole module lines from the end.
 */
export function buildLibraryOverviewBlock(
  entriesByModule: ReadonlyMap<string, readonly string[]>,
  customModules: readonly CustomModuleDefinition[],
  totalEntries: number,
): string {
  const budget = CONTEXT_BLOCK_TOKEN_BUDGET.libraryOverview
  const modules = orderModules(customModules).map((module) => ({
    ...module,
    titles: (entriesByModule.get(moduleKey(module.kind, module.customModuleId)) ?? []).slice(
      0,
      LIBRARY_OVERVIEW_TITLES_PER_MODULE,
    ),
  }))
  let trimmedTitles = false
  for (;;) {
    if (fitsWithNote(renderOverview(modules, totalEntries), trimmedTitles, budget)) {
      return withTrimNote(renderOverview(modules, totalEntries), trimmedTitles)
    }
    const target = lastModuleWithSpareTitles(modules)
    if (target === -1) break
    modules[target]?.titles.pop()
    trimmedTitles = true
  }
  let kept = modules
  let omittedModules = false
  while (kept.length > 0) {
    const rendered = renderOverview(kept, totalEntries)
    if (fitsWithNote(rendered, trimmedTitles || omittedModules, budget)) {
      return withTrimNote(rendered, trimmedTitles, omittedModules)
    }
    kept = kept.slice(0, -1)
    omittedModules = true
  }
  return withTrimNote(renderOverview([], totalEntries), trimmedTitles, true)
}

interface OverviewModule {
  readonly kind: InfoModuleKind
  readonly customModuleId: CustomModuleDefinition['id'] | null
  readonly label: string
  titles: string[]
}

function orderModules(customModules: readonly CustomModuleDefinition[]): OverviewModule[] {
  const builtIn: OverviewModule[] = BUILT_IN_MODULE_KINDS.map((kind) => ({
    kind,
    customModuleId: null,
    label: moduleDescriptor(kind, null).label,
    titles: [],
  }))
  const custom = [...customModules]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((module) => ({
      kind: 'custom' as const,
      customModuleId: module.id,
      label: module.name,
      titles: [] as string[],
    }))
  return [...builtIn, ...custom]
}

/** The last module in render order that may still give up one title. */
function lastModuleWithSpareTitles(modules: readonly OverviewModule[]): number {
  for (let index = modules.length - 1; index >= 0; index -= 1) {
    const module = modules[index]
    if (module !== undefined && module.titles.length > LIBRARY_OVERVIEW_MIN_TITLES) return index
  }
  return -1
}

function renderOverview(
  modules: readonly OverviewModule[],
  totalEntries: number,
): string {
  const lines = [`共 ${totalEntries.toString()} 条信息。`]
  for (const module of modules) {
    const list = module.titles.length === 0 ? '' : `：${module.titles.join('、')}`
    lines.push(`- ${module.label}${list}`)
  }
  return lines.join('\n')
}

function fitsWithNote(rendered: string, hasNote: boolean, budget: number): boolean {
  const allowance = hasNote ? TRIM_NOTE_TOKEN_ALLOWANCE : 0
  return estimateTokens(rendered) + allowance <= budget
}

function withTrimNote(
  rendered: string,
  trimmedTitles: boolean,
  omittedModules = false,
): string {
  if (!trimmedTitles && !omittedModules) return rendered
  const notes: string[] = []
  if (trimmedTitles) notes.push('部分模块只列出前若干条标题')
  if (omittedModules) notes.push('部分模块概览已省略')
  return `${rendered}\n（信息库概览已按长度限制裁剪：${notes.join('；')}。）`
}

function moduleKey(kind: InfoModuleKind, customModuleId: CustomModuleDefinition['id'] | null): string {
  return `${kind}:${customModuleId ?? ''}`
}

function truncateCodePoints(text: string, limit: number): string {
  const points = [...text]
  if (points.length <= limit) return text
  return `${points.slice(0, limit - 1).join('')}…`
}
