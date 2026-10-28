/**
 * @file classicSingle
 * @description The default template: a centred name, a thin rule under the
 * header, and section headings as a bold line with an underline. It is the
 * template every resume falls back to, so it stays conservative in spacing and
 * type size.
 */

import { asTemplateId } from '../../shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../ResumeSection'
import type { TemplateDefinition } from '../Template'
import { appearanceFor, pageSetupFor, styleToken } from './tokens'

export const classicSingle: TemplateDefinition = {
  id: asTemplateId('classic-single'),
  name: '经典单栏',
  description: '居中姓名、细分隔线，章节标题加下边框，适合大多数岗位。',
  supports: { columns: [1] },
  defaultSectionOrder: CANONICAL_SECTION_ORDER,
  tokens: {
    name: styleToken(20, 700, 1.2),
    contact: styleToken(9.5, 400, 1.4),
    sectionHeader: styleToken(12, 700, 1.3),
    entryHeading: styleToken(11, 700, 1.35),
    entryMeta: styleToken(9.5, 400, 1.35),
    entryBody: styleToken(10.5, 400, 1.5),
    freeText: styleToken(10.5, 400, 1.5),
    headerLayout: 'centered',
    ruleAfterHeader: true,
    sectionSpacing: 16,
    entrySpacing: 8,
    paragraphSpacing: 3,
    bulletIndent: 12,
    columnRatio: 0.35,
    sidebarMode: false,
    columnGutter: 12,
  },
  defaults: {
    appearance: appearanceFor('ink', 'underline', 16),
    pageSetup: pageSetupFor(72, 1),
  },
}
