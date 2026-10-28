/**
 * @file editorial
 * @description An editorial-style single column: generous margins and section
 * spacing, a large name, and plain section headings so the white space carries
 * the hierarchy. Section headings are meant to sit beside their dates; the
 * layout keeps them as their own block so the treatment is a renderer decision.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const editorial: TemplateDefinition = {
  id: asTemplateId('editorial'),
  name: '编辑排版风',
  description: '大留白与 20pt 章节间距，标题右对齐时间，适合内容较少的精致简历。',
  supports: { columns: [1] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(22, 700, 1.2),
    contact: styleToken(9.5, 400, 1.45),
    sectionHeader: styleToken(11, 700, 1.3),
    entryHeading: styleToken(11, 700, 1.35),
    entryMeta: styleToken(9.5, 400, 1.35),
    entryBody: styleToken(10.5, 400, 1.55),
    freeText: styleToken(10.5, 400, 1.55),
    headerLayout: 'split',
    ruleAfterHeader: true,
    sectionSpacing: 20,
    entrySpacing: 10,
    paragraphSpacing: 4,
    bulletIndent: 14,
    columnRatio: 0.35,
    sidebarMode: false,
    columnGutter: 12,
  },
  defaults: {
    appearance: appearanceFor('ink', 'plain', 20, 1.55),
    pageSetup: pageSetupFor(80, 1),
  },
}
