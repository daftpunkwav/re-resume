/**
 * @file experienceKindLabels
 * @description The interface vocabulary of the catalog: what an experience
 * kind, a claim kind, a claim status and each fact or detail field are called
 * on screen. The field names themselves are read from the Zod schemas, so this
 * module only supplies the wording for a name it is given.
 *
 * Responsibilities:
 * - Name every ExperienceKind, ClaimKind and ClaimStatus in interface text
 * - Name every field the fact form and the per-kind detail form render
 * - Turn the argument failure a refused command returns into one sentence
 *
 * Constraints:
 * - This module must not read state or call a use case; it holds no data.
 * - The domain spells its values in English and the interface shows Chinese, so
 *   the mapping lives here rather than being repeated in each panel.
 */

import { z } from 'zod'
import { describeError } from '../../app/errorMessages'
import type { ClaimKind } from '../../../domain/catalog/ClaimKind'
import type { ClaimStatus } from '../../../domain/catalog/ClaimStatus'
import type { ExperienceKind } from '../../../domain/catalog/ExperienceKind'

export const EXPERIENCE_KIND_LABELS: Readonly<Record<ExperienceKind, string>> = {
  education: '教育经历',
  internship: '实习经历',
  work: '工作经历',
  project: '项目经历',
  award: '获奖与竞赛',
  skill: '专业技能',
  summary: '个人评价',
}

export const CLAIM_KIND_LABELS: Readonly<Record<ClaimKind, string>> = {
  metric: '量化数据',
  responsibility: '职责归属',
  skill: '技能声明',
}

export const CLAIM_STATUS_LABELS: Readonly<Record<ClaimStatus, string>> = {
  confirmed: '已确认',
  pending: '待确认',
  rejected: '已拒绝',
}

/**
 * One flat map because the per-kind schemas do not reuse a field name for two
 * different meanings; a kind-specific map would repeat the same entry seven
 * times and hide a collision rather than prevent one.
 */
export const EXPERIENCE_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '标题',
  organization: '单位',
  startDate: '开始日期',
  endDate: '结束日期',
  isCurrent: '至今',
  detail: '详情',
  school: '学校',
  degree: '学历',
  major: '专业',
  gpa: 'GPA',
  honors: '荣誉',
  company: '公司',
  team: '团队',
  role: '角色',
  technologies: '技术栈',
  department: '部门',
  highlights: '亮点',
  repoUrl: '代码仓库',
  issuer: '颁发机构',
  level: '级别',
  certificateNo: '证书编号',
  category: '分类',
  items: '技能条目',
  proficiency: '熟练度',
}

/**
 * Falls back to the raw name rather than an empty label: a field this map does
 * not carry still has to be identifiable on screen and in a failure message.
 */
export function describeFieldName(field: string): string {
  return EXPERIENCE_FIELD_LABELS[field] ?? field
}

/**
 * A failed command carries an argument error rather than throwing one. The
 * caller turns this sentence into an exception so useOperation reports it
 * through describeError like any other failure; invariant refusals are thrown
 * by the use case and never reach here.
 */
export function describeCommandFailure(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    if (issue === undefined) return describeError(error).message
    const field = lastNamedSegment(issue.path)
    return field === '' ? issue.message : `${describeFieldName(field)}：${issue.message}`
  }
  return describeError(error).message
}

/**
 * Array indices carry no name of their own, so the last segment that does is
 * the field a reader can act on: ["technologies", 0] names "technologies".
 */
function lastNamedSegment(path: readonly PropertyKey[]): string {
  const named = path.filter((segment): segment is string => typeof segment === 'string')
  return named[named.length - 1] ?? ''
}
