/**
 * @file templates index
 * @description The ordered bundle of built-in templates. Registry order is the
 * order the template gallery shows, so it is declared here rather than derived.
 */

import type { TemplateDefinition } from '../Template'
import { classicSingle } from './classicSingle'
import { editorial } from './editorial'
import { emphasizedHeader } from './emphasizedHeader'
import { minimal } from './minimal'
import { technical } from './technical'
import { twoColumnSidebar } from './twoColumnSidebar'

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  classicSingle,
  emphasizedHeader,
  twoColumnSidebar,
  editorial,
  technical,
  minimal,
]
