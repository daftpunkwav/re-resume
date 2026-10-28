/**
 * @file emphasizedHeader
 * @description A template whose name block dominates the page: a large name,
 * contact details on their own lines and a light header band, with smaller
 * section headings below so the identity is the first thing a reader sees.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const emphasizedHeader: TemplateDefinition = {
  id: asTemplateId('emphasized-header'),
  name: '强调头部',
  description: '姓名放大到 24pt，联系信息分两行，头部带浅底块，突出个人品牌。',
  supports: { columns: [1] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(24, 700, 1.15),
    contact: styleToken(10, 400, 1.45),
    sectionHeader: styleToken(12, 700, 1.3),
    entryHeading: styleToken(11, 700, 1.35),
    entryMeta: styleToken(9.5, 400, 1.35),
    entryBody: styleToken(10.5, 400, 1.5),
    freeText: styleToken(10.5, 400, 1.5),
    headerLayout: 'centered',
    ruleAfterHeader: false,
    sectionSpacing: 14,
    entrySpacing: 8,
    paragraphSpacing: 3,
    bulletIndent: 12,
    columnRatio: 0.35,
    sidebarMode: false,
    columnGutter: 12,
  },
  defaults: {
    appearance: appearanceFor('blue', 'boxed', 14),
    pageSetup: pageSetupFor(64, 1, { marginTop: 64, marginBottom: 72 }),
  },
}
