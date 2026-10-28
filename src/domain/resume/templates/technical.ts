/**
 * @file technical
 * @description A technical-role template: a left-aligned header, accent-bar
 * section headings and tight body spacing, so a dense stack of projects and
 * skills reads as a single run of work. The bundled font is the only family
 * available, so the "technical" character comes from weight and spacing rather
 * than a second typeface.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const technical: TemplateDefinition = {
  id: asTemplateId('technical'),
  name: '技术岗',
  description: '左对齐头部、章节标题带强调色竖条，信息密度高，适合技术岗位。',
  supports: { columns: [1] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(19, 700, 1.2),
    contact: styleToken(9.5, 400, 1.4),
    sectionHeader: styleToken(11.5, 700, 1.3),
    entryHeading: styleToken(10.5, 700, 1.35),
    entryMeta: styleToken(9.5, 700, 1.35),
    entryBody: styleToken(10, 400, 1.45),
    freeText: styleToken(10, 400, 1.45),
    headerLayout: 'left',
    ruleAfterHeader: true,
    sectionSpacing: 14,
    entrySpacing: 8,
    paragraphSpacing: 3,
    bulletIndent: 12,
    columnRatio: 0.35,
    sidebarMode: false,
    columnGutter: 12,
  },
  defaults: {
    appearance: appearanceFor('green', 'accentBar', 14),
    pageSetup: pageSetupFor(64, 1),
  },
}
