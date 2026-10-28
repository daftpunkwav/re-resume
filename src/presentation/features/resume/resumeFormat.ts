/**
 * @file resumeFormat
 * @description Presentation vocabulary for the resume studio: Chinese labels,
 * colour swatches and short formatting helpers. Everything here is display
 * only; the domain keeps the values and the rules.
 *
 * Constraints:
 * - No storage, no service call, no layout maths: the studio store and the
 *   components decide behaviour, this module only names things.
 * - The accent swatches are interface samples. The resume's own palette is
 *   applied by the materializer and the canvas, not by these constants.
 */

import type { AccentColor, HeadingStyle } from '../../../domain/resume/AppearanceSettings'
import type { CustomModuleId } from '../../../domain/shared/branded-id'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import { MODULE_DESCRIPTORS, moduleDescriptor } from '../../../domain/info/InfoModuleKind'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { MissingReference } from '../../../domain/resume/MissingReference'
import type { OverflowReason } from '../../../domain/resume/PageLayout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { PaperSize } from '../../../domain/resume/PageSetup'
import type { Resume, ResumeStatus } from '../../../domain/resume/Resume'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import { sectionDisplayName } from '../../../domain/resume/ResumeSection'
import type { TemplateDefinition } from '../../../domain/resume/Template'

/** One accent colour as the interface samples it. */
export interface AccentSwatch {
  readonly id: AccentColor
  readonly label: string
  readonly hex: string
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { id: 'ink', label: '墨黑', hex: '#1f2328' },
  { id: 'blue', label: '靛蓝', hex: '#2563eb' },
  { id: 'teal', label: '青绿', hex: '#0d9488' },
  { id: 'green', label: '苔绿', hex: '#16a34a' },
  { id: 'amber', label: '琥珀', hex: '#d97706' },
  { id: 'rose', label: '绯红', hex: '#e11d48' },
]

export function accentHex(color: AccentColor): string {
  return ACCENT_SWATCHES.find((swatch) => swatch.id === color)?.hex ?? '#1f2328'
}

export const HEADING_STYLE_LABELS: Readonly<Record<HeadingStyle, string>> = {
  plain: '素净',
  accentBar: '强调竖条',
  underline: '下划线',
  boxed: '方框',
}

export const PAPER_LABELS: Readonly<Record<PaperSize, string>> = {
  A4: 'A4',
  Letter: 'Letter',
}

export function paperLabel(paper: PaperSize): string {
  return paper === 'A4' ? 'A4（210 × 297 mm）' : 'Letter（216 × 279 mm）'
}

export function resumeStatusLabel(status: ResumeStatus): string {
  return status === 'frozen' ? '已定稿' : '草稿'
}

/** `岗位 · 公司` with whichever parts exist, or a quiet placeholder. */
export function targetJobText(resume: Pick<Resume, 'targetJob'>): string {
  const parts = [resume.targetJob?.title ?? '', resume.targetJob?.company ?? '']
  const text = parts.filter((part) => part !== '').join(' · ')
  return text === '' ? '未设置目标岗位' : text
}

/** Short absolute time: `9月3日 14:32`; a time in the same day keeps only the clock. */
export function formatUpdatedAt(updatedAt: string, now: number = Date.now()): string {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date(now)
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  const clock = `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
  if (sameDay) return `今天 ${clock}`
  const month = date.getMonth() + 1
  const day = date.getDate()
  if (date.getFullYear() === today.getFullYear()) return `${month.toString()}月${day.toString()}日`
  return `${date.getFullYear().toString()}年${month.toString()}月${day.toString()}日`
}

/** The heading a chapter shows: the user's name when set, the module default otherwise. */
export function sectionHeading(
  section: ResumeSection,
  customModule: CustomModuleDefinition | null,
): string {
  return sectionDisplayName(section, customModule)
}

/** The module a chapter renders, spelled for the interface. */
export function sectionModuleLabel(
  section: ResumeSection,
  customModule: CustomModuleDefinition | null,
): string {
  if (section.moduleKind === 'custom' && customModule === null) return '自定义模块（已删除）'
  return moduleDescriptor(section.moduleKind, customModule).label
}

/**
 * A chapter's entry limit, or null when it selects without bound. A custom
 * chapter whose module definition is gone is still a chapter; it keeps the
 * custom descriptor's unbounded limit so the UI can show the missing module
 * instead of failing to render.
 */
export function sectionEntryLimit(
  section: ResumeSection,
  customModule: CustomModuleDefinition | null,
): number | null {
  if (section.moduleKind === 'custom' && customModule === null) {
    return MODULE_DESCRIPTORS.custom.maxSelectedEntries
  }
  return moduleDescriptor(section.moduleKind, customModule).maxSelectedEntries
}

/** The entries a chapter selects, resolved from the library; missing ones stay as `null`. */
export function resolvedSectionEntries(
  section: ResumeSection,
  entriesById: ReadonlyMap<string, InfoEntry>,
): readonly (InfoEntry | null)[] {
  return section.entryIds.map((entryId) => entriesById.get(entryId) ?? null)
}

/** An entry's one-line identity in a picker or a chapter row. */
export function entryLabel(entry: InfoEntry): string {
  return entry.title
}

/** A summary or entry rewrite as the panel lists it. */
export function overrideTargetLabel(override: ResumeOverride): string {
  return override.target.kind === 'summary' ? '个人简介 / 总结' : '条目改写'
}

/** True for text the agent wrote and the user has not edited since. */
export function isAgentAuthored(override: Pick<ResumeOverride, 'origin' | 'editedByUser'>): boolean {
  return override.origin === 'agent' && !override.editedByUser
}

export function missingReferenceText(reference: MissingReference): string {
  switch (reference.kind) {
    case 'entry':
      return '这一章引用的条目已删除'
    case 'customModule':
      return '这一章引用的自定义模块已删除'
    case 'override':
      return '有一段条目改写找不到原条目'
    case 'template':
      return '这份简历使用的模板已不存在'
    case 'jobPosting':
      return '关联的岗位记录已删除'
  }
}

export function overflowReasonText(reason: OverflowReason): string {
  switch (reason) {
    case 'block-taller-than-column':
      return '内容高于整栏'
    case 'absolute-out-of-bounds':
      return '自由块超出内容框'
    case 'free-block-off-page':
      return '自由块所在页不存在'
    case 'missing-image':
      return '图片附件缺失'
  }
}

/** The module kinds a chapter can be created for, custom modules expanded. */
export function selectableModules(
  customModules: readonly CustomModuleDefinition[],
): readonly { readonly moduleKind: InfoModuleKind; readonly customModuleId: CustomModuleId | null; readonly label: string }[] {
  const builtIn = [
    'personal',
    'jobIntent',
    'education',
    'internship',
    'project',
    'skill',
    'award',
    'selfEvaluation',
    'custom',
  ] as const
  const modules = builtIn
    .filter((kind) => kind !== 'custom')
    .map((kind) => ({
      moduleKind: kind,
      customModuleId: null,
      label: moduleDescriptor(kind, null).label,
    }))
  return [
    ...modules,
    ...customModules.map((module) => ({
      moduleKind: 'custom' as const,
      customModuleId: module.id,
      label: module.name,
    })),
  ]
}

/** The columns a template supports, spelled for the segmented control. */
export function templateColumnLabel(template: TemplateDefinition): string {
  return template.supports.columns.includes(2) ? '双栏' : '单栏'
}

/** Page geometry summary shown under the canvas. */
export function pageSetupSummary(page: PageSetup): string {
  return `${PAPER_LABELS[page.paper]} · ${page.columns === 2 ? '双栏' : '单栏'} · 边距 ${page.marginLeft.toString()}`
}
