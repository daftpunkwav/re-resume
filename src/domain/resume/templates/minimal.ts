/**
 * @file minimal
 * @description The quietest template: narrow margins, small plain headings and
 * no rules, so the page carries nothing but the content. It is the template to
 * pick when the writing should do all the work.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const minimal: TemplateDefinition = {
  id: asTemplateId('minimal'),
  name: '简洁极简',
  description: '无分隔线、10pt 章节标题与 56pt 窄边距，只留内容本身。',
  supports: { columns: [1] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(18, 700, 1.2),
    contact: styleToken(9, 400, 1.4),
    sectionHeader: styleToken(10, 700, 1.3),
    entryHeading: styleToken(10.5, 700, 1.35),
    entryMeta: styleToken(9, 400, 1.35),
    entryBody: styleToken(10, 400, 1.5),
    freeText: styleToken(10, 400, 1.5),
    headerLayout: 'left',
    ruleAfterHeader: false,
    sectionSpacing: 10,
    entrySpacing: 6,
    paragraphSpacing: 2,
    bulletIndent: 10,
    columnRatio: 0.35,
    sidebarMode: false,
    columnGutter: 12,
  },
  defaults: {
    appearance: appearanceFor('ink', 'plain', 10),
    pageSetup: pageSetupFor(56, 1),
  },
}
