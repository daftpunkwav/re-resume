/**
 * @file InfoModuleKind
 * @description The closed set of information modules and the display facts each
 * one carries. A custom module is one kind whose label and title field come from
 * its definition rather than from the fixed table.
 *
 * Responsibilities:
 * - Declare the nine module kinds and their descriptors
 * - Resolve the descriptor of a kind, including the custom-module case
 * - Provide the runtime guard the row mapper and the tools need
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - Labels and default section names are part of the user-facing contract; the
 *   UI reads them instead of keeping a second copy.
 */

import { DomainError } from '../shared/DomainError'
import type { CustomModuleDefinition } from './CustomModule'

export const INFO_MODULE_KINDS = [
  'personal',
  'education',
  'internship',
  'project',
  'skill',
  'award',
  'jobIntent',
  'selfEvaluation',
  'custom',
] as const

export type InfoModuleKind = (typeof INFO_MODULE_KINDS)[number]

/**
 * The fixed modules, in canonical order. `custom` is a kind but not one module:
 * each custom module is its own instance with its own definition, so it is
 * named by the definition list rather than by this set.
 */
export const BUILT_IN_MODULE_KINDS = INFO_MODULE_KINDS.filter(
  (kind): kind is Exclude<InfoModuleKind, 'custom'> => kind !== 'custom',
)

export interface ModuleDescriptor {
  readonly kind: InfoModuleKind
  /** Display name in the interface. */
  readonly label: string
  /** Heading a resume section uses when the user has not renamed it. */
  readonly defaultSectionName: string
  /** Upper bound a resume section may select; null means unlimited. */
  readonly maxSelectedEntries: number | null
  /** Field key whose value titles an entry of this module. */
  readonly titleFieldKey: string
}

/**
 * Fixed descriptors. `personal` and `jobIntent` hold a single selected entry:
 * a resume renders one header identity and one intent, and allowing several
 * would leave the rendering with no rule for choosing between them.
 */
export const MODULE_DESCRIPTORS: Readonly<Record<InfoModuleKind, ModuleDescriptor>> = {
  personal: {
    kind: 'personal',
    label: '个人信息',
    defaultSectionName: '个人信息',
    maxSelectedEntries: 1,
    titleFieldKey: 'fullName',
  },
  education: {
    kind: 'education',
    label: '教育经历',
    defaultSectionName: '教育经历',
    maxSelectedEntries: null,
    titleFieldKey: 'school',
  },
  internship: {
    kind: 'internship',
    label: '实习经历',
    defaultSectionName: '实习经历',
    maxSelectedEntries: null,
    titleFieldKey: 'company',
  },
  project: {
    kind: 'project',
    label: '项目经历',
    defaultSectionName: '项目经历',
    maxSelectedEntries: null,
    titleFieldKey: 'name',
  },
  skill: {
    kind: 'skill',
    label: '个人技能',
    defaultSectionName: '个人技能',
    maxSelectedEntries: null,
    titleFieldKey: 'name',
  },
  award: {
    kind: 'award',
    label: '竞赛与获奖',
    defaultSectionName: '竞赛与获奖',
    maxSelectedEntries: null,
    titleFieldKey: 'name',
  },
  jobIntent: {
    kind: 'jobIntent',
    label: '求职意向',
    defaultSectionName: '求职意向',
    maxSelectedEntries: 1,
    titleFieldKey: 'targetRole',
  },
  selfEvaluation: {
    kind: 'selfEvaluation',
    label: '自我评价',
    defaultSectionName: '自我评价',
    maxSelectedEntries: null,
    titleFieldKey: 'content',
  },
  custom: {
    kind: 'custom',
    label: '自定义模块',
    defaultSectionName: '自定义模块',
    maxSelectedEntries: null,
    titleFieldKey: 'title',
  },
}

export function isInfoModuleKind(value: unknown): value is InfoModuleKind {
  return typeof value === 'string' && (INFO_MODULE_KINDS as readonly string[]).includes(value)
}

/**
 * Resolves the descriptor for a kind. A custom module's label and section name
 * are its definition's name, so this function is the single place that decides
 * how a module is called.
 *
 * @throws DomainError `customModuleNotFound` when a custom kind is asked for
 *   without the definition that names it.
 */
export function moduleDescriptor(
  kind: InfoModuleKind,
  custom: CustomModuleDefinition | null,
): ModuleDescriptor {
  if (kind !== 'custom') return MODULE_DESCRIPTORS[kind]
  if (custom === null) {
    throw new DomainError('customModuleNotFound', 'The custom module definition is missing.', {
      entity: 'customModule',
      id: '',
      blockers: [],
    })
  }
  return {
    kind: 'custom',
    label: custom.name,
    defaultSectionName: custom.name,
    maxSelectedEntries: null,
    titleFieldKey: 'title',
  }
}
