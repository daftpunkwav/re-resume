/**
 * @file twoColumnSidebar
 * @description The only bundled two-column template: a 34% sidebar carries the
 * identity, skills, awards and job intent, while the body column carries
 * education, internships, projects and custom modules. The sidebar is filled
 * first in document order, which is what lets `layout()` know nothing about
 * templates.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const twoColumnSidebar: TemplateDefinition = {
  id: asTemplateId('two-column-sidebar'),
  name: '双栏侧边栏',
  description: '第 1 栏 34% 放个人信息、技能、获奖与求职意向，第 2 栏放经历与项目。',
  supports: { columns: [2] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(18, 700, 1.2),
    contact: styleToken(9, 400, 1.45),
    sectionHeader: styleToken(11, 700, 1.3),
    entryHeading: styleToken(10.5, 700, 1.35),
    entryMeta: styleToken(9, 400, 1.35),
    entryBody: styleToken(10, 400, 1.5),
    freeText: styleToken(10, 400, 1.5),
    headerLayout: 'left',
    ruleAfterHeader: false,
    sectionSpacing: 12,
    entrySpacing: 6,
    paragraphSpacing: 2,
    bulletIndent: 10,
    columnRatio: 0.34,
    sidebarMode: true,
    columnGutter: 18,
  },
  defaults: {
    appearance: appearanceFor('teal', 'accentBar', 12),
    pageSetup: pageSetupFor(64, 2, { marginLeft: 56, marginTop: 56, marginBottom: 56 }),
  },
}
