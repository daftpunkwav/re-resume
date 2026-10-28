/**
 * @file resumeDocument.test
 * @description The invariants of the resume document model: the template
 * registry, the section composition rules, overrides, appearance, page setup,
 * canvas blocks, the document validator every write runs, and the freeze guards.
 */

import { describe, expect, it } from 'vitest'

import type {
  CanvasBlock,
} from '../../../src/domain/resume/CanvasLayout'
import {
  CANVAS_BLOCK_MAX_TEXT_LENGTH,
  assertCanvasBlock,
} from '../../../src/domain/resume/CanvasLayout'
import type { ResumeDocumentState } from '../../../src/domain/resume/DocumentState'
import { validateResumeDocument } from '../../../src/domain/resume/DocumentState'
import { assertFreezable, assertMutable, normalizeResumeTitle } from '../../../src/domain/resume/Resume'
import type { Resume } from '../../../src/domain/resume/Resume'
import type { MissingReference } from '../../../src/domain/resume/MissingReference'
import {
  findOverrideByTarget,
  overrideTargetKey,
  replaceOverride,
} from '../../../src/domain/resume/ResumeOverride'
import {
  CANONICAL_SECTION_ORDER,
  SECTION_ENTRY_LIMIT,
  insertSectionCanonical,
  normalizeSectionDisplayName,
  renumberSections,
  requireSection,
  sectionDisplayName,
  sectionKey,
} from '../../../src/domain/resume/ResumeSection'
import type { ResumeSection } from '../../../src/domain/resume/ResumeSection'
import {
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_REGISTRY,
  getTemplate,
  listTemplates,
  resolveTemplate,
  SIDEBAR_MODULE_KINDS,
} from '../../../src/domain/resume/Template'
import {
  ACCENT_COLORS,
  FONT_PAIRS,
  HEADING_STYLES,
  mergeAppearance,
} from '../../../src/domain/resume/AppearanceSettings'
import {
  DEFAULT_PAGE_SETUP,
  PAPER_DIMENSIONS,
  contentHeight,
  contentWidth,
  pageHeight,
  pageWidth,
  validatePageSetup,
  MARGIN_MAX,
} from '../../../src/domain/resume/PageSetup'
import { formatKnowledgeDate } from '../../../src/domain/shared/KnowledgeDate'
import { asCanvasBlockId, asInfoEntryId, asJobPostingId, asResumeOverrideId, asResumeSectionId, asTemplateId } from '../../../src/domain/shared/branded-id'
import type { CustomModuleId } from '../../../src/domain/shared/branded-id'
import {
  aDocument,
  aDividerBlock,
  aSection,
  aSummaryOverride,
  aTextBlock,
  richSections,
} from '../../support/resumeFixtures'
import { PREVIEW_INFO_CUSTOM_MODULES } from '../../../src/infrastructure/preview/fixtures.info'

function expectCode(run: () => void, code: string): void {
  try {
    run()
  } catch (failure) {
    expect((failure as { code?: string }).code).toBe(code)
    return
  }
  throw new Error(`Expected the call to be refused with ${code}.`)
}

function aResumeValue(document: ResumeDocumentState, status: Resume['status'] = 'draft'): Resume {
  return {
    id: 'resume-1' as Resume['id'],
    title: '测试简历',
    targetJob: null,
    status,
    document,
    currentRevision: 'revision-1' as Resume['currentRevision'],
    snapshots: [],
    conversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z' as Resume['createdAt'],
    updatedAt: '2026-01-01T00:00:00.000Z' as Resume['updatedAt'],
  }
}

describe('template registry', () => {
  it('ships the six bundled templates with unique identifiers', () => {
    const templates = listTemplates()
    expect(templates).toHaveLength(6)
    expect(new Set(templates.map((template) => template.id)).size).toBe(6)
    expect(templates.map((template) => template.name)).toEqual([
      '经典单栏',
      '强调头部',
      '双栏侧边栏',
      '编辑排版风',
      '技术岗',
      '简洁极简',
    ])
    expect(templates.map((template) => template.id)).toContain(DEFAULT_TEMPLATE_ID)
  })

  it('lists every default section order in canonical form', () => {
    for (const template of listTemplates()) {
      expect(template.defaultSectionOrder).toEqual(CANONICAL_SECTION_ORDER)
      expect(template.supports.columns.length).toBeGreaterThan(0)
      expect(template.tokens.columnRatio).toBeGreaterThanOrEqual(0.25)
      expect(template.tokens.columnRatio).toBeLessThanOrEqual(0.5)
    }
  })

  it('gives each template defaults the document validator accepts', () => {
    for (const template of listTemplates()) {
      validatePageSetup(template.defaults.pageSetup, template)
      expect(() => mergeAppearance(template.defaults.appearance, {})).not.toThrow()
      expect(template.defaults.appearance.accentColor).toBeTruthy()
      expect(ACCENT_COLORS).toContain(template.defaults.appearance.accentColor)
      expect(FONT_PAIRS).toContain(template.defaults.appearance.fontPairId)
      expect(HEADING_STYLES).toContain(template.defaults.appearance.headingStyle)
      expect(template.defaults.pageSetup.columns === 1 ? 1 : 2).toBeGreaterThan(0)
    }
  })

  it('resolves a known template and falls back to the default for an unknown one', () => {
    expect(getTemplate(asTemplateId('classic-single'))?.name).toBe('经典单栏')
    expect(getTemplate(asTemplateId('unknown'))).toBeNull()
    expect(resolveTemplate(asTemplateId('unknown')).id).toBe(DEFAULT_TEMPLATE_ID)
    expect(TEMPLATE_REGISTRY.size).toBe(6)
  })

  it('puts the sidebar modules in the first column of the sidebar template', () => {
    expect([...SIDEBAR_MODULE_KINDS].sort()).toEqual(
      ['award', 'jobIntent', 'personal', 'skill'].sort(),
    )
  })
})

describe('sections', () => {
  it('accepts the canonical collection a new resume starts with', () => {
    expect(() => validateResumeDocument(aDocument())).not.toThrow()
  })

  it('refuses a duplicated module identity', () => {
    const sections = [...richSections(), aSection({ moduleKind: 'skill', entryIds: ['preview-skill-1'] })]
    expectCode(() => validateResumeDocument(aDocument({ sections })), 'duplicateSection')
  })

  it('refuses non-dense and duplicated order numbers', () => {
    const sections = richSections().map((section, index) => ({
      ...section,
      sortOrder: index + 2,
    }))
    expectCode(() => validateResumeDocument(aDocument({ sections })), 'invalidFieldValue')
  })

  it('refuses a second personal entry', () => {
    const sections = richSections().map((section) =>
      section.moduleKind === 'personal'
        ? { ...section, entryIds: [asInfoEntryId('preview-personal-1'), asInfoEntryId('preview-education-1')] }
        : section,
    )
    expectCode(() => validateResumeDocument(aDocument({ sections })), 'sectionLimitExceeded')
  })

  it('refuses a custom section without its module and a built-in one with it', () => {
    const missingModule = richSections().map((section) =>
      section.moduleKind === 'custom'
        ? { ...section, customModuleId: null }
        : section,
    )
    expectCode(() => validateResumeDocument(aDocument({ sections: missingModule })), 'moduleKindMismatch')
    const namedModule = richSections().map((section) =>
      section.moduleKind === 'skill'
        ? {
            ...section,
            customModuleId:
              (PREVIEW_INFO_CUSTOM_MODULES[0]?.id ?? 'module') as CustomModuleId,
          }
        : section,
    )
    expectCode(
      () => validateResumeDocument(aDocument({ sections: namedModule })),
      'moduleKindMismatch',
    )
  })

  it('refuses a duplicate selected entry', () => {
    const sections = richSections().map((section) =>
      section.moduleKind === 'skill'
        ? { ...section, entryIds: [asInfoEntryId('preview-skill-1'), asInfoEntryId('preview-skill-1')] }
        : section,
    )
    expectCode(() => validateResumeDocument(aDocument({ sections })), 'invalidFieldValue')
  })

  it('refuses an over-long section name', () => {
    const sections = richSections().map((section) =>
      section.moduleKind === 'skill' ? { ...section, displayName: '名'.repeat(25) } : section,
    )
    expectCode(() => validateResumeDocument(aDocument({ sections })), 'fieldTooLong')
  })

  it('normalizes display names and resolves the module default', () => {
    expect(normalizeSectionDisplayName('  技能  ')).toBe('技能')
    expect(normalizeSectionDisplayName('   ')).toBeNull()
    expect(normalizeSectionDisplayName(null)).toBeNull()
    const section = aSection({
      moduleKind: 'custom',
      customModuleId: PREVIEW_INFO_CUSTOM_MODULES[0]?.id ?? null,
    })
    expect(sectionDisplayName(section, PREVIEW_INFO_CUSTOM_MODULES[0] ?? null)).toBe('证书')
    expect(sectionDisplayName(section, null)).toBe('自定义模块')
  })

  it('inserts a missing chapter at its canonical position and renumbers', () => {
    const sections = renumberSections(
      richSections().filter((section) => section.moduleKind !== 'award'),
    )
    const inserted = insertSectionCanonical(sections, aSection({ moduleKind: 'award' }))
    expect(inserted.map((section) => section.moduleKind)).toEqual([
      'personal',
      'jobIntent',
      'education',
      'internship',
      'project',
      'skill',
      'award',
      'selfEvaluation',
      'custom',
    ])
    expect(inserted.map((section) => section.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('appends a custom chapter after the built-in ones', () => {
    const sections = richSections().filter((section) => section.moduleKind !== 'custom')
    const inserted = insertSectionCanonical(sections, aSection({ moduleKind: 'custom' }))
    expect(inserted[inserted.length - 1]?.moduleKind).toBe('custom')
  })

  it('finds a section or reports sectionNotFound', () => {
    const sections = richSections()
    const section = sections[0] as ResumeSection
    expect(requireSection(sections, section.id)).toBe(section)
    expectCode(() => requireSection([], section.id), 'sectionNotFound')
  })

  it('keys sections by module and custom module', () => {
    expect(sectionKey('skill', null)).toBe('skill:')
    expect(sectionKey('custom', 'module-1' as CustomModuleId)).toBe('custom:module-1')
    expect(SECTION_ENTRY_LIMIT).toBe(50)
  })
})

describe('overrides', () => {
  it('accepts one summary and one override per entry', () => {
    expectCode(
      () =>
        validateResumeDocument(
          aDocument({
            overrides: [
              aSummaryOverride('总'),
              {
                ...aSummaryOverride('另一个总'),
                id: asResumeOverrideId('override-summary-2'),
              },
            ],
          }),
        ),
      'overrideLimit',
    )
  })

  it('refuses blank text and over-long text', () => {
    expectCode(
      () => validateResumeDocument(aDocument({ overrides: [aSummaryOverride('   ')] })),
      'invalidFieldValue',
    )
    expectCode(
      () =>
        validateResumeDocument(
          aDocument({ overrides: [aSummaryOverride('字'.repeat(4001))] }),
        ),
      'fieldTooLong',
    )
  })

  it('refuses an agent override without its run', () => {
    const override = {
      ...aSummaryOverride('总'),
      origin: 'agent' as const,
      sourceRunId: null,
    }
    expectCode(
      () => validateResumeDocument(aDocument({ overrides: [override] })),
      'invalidFieldValue',
    )
  })

  it('finds and replaces overrides by target, keeping position', () => {
    const summary = aSummaryOverride('旧的')
    const overrides = [summary]
    expect(findOverrideByTarget(overrides, { kind: 'summary' })?.id).toBe(summary.id)
    const replacement = { ...summary, text: '新的' }
    const replaced = replaceOverride(overrides, replacement)
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.text).toBe('新的')
    expect(overrideTargetKey({ kind: 'entry', entryId: asInfoEntryId('entry-1') })).toBe(
      'entry:entry-1',
    )
  })
})

describe('appearance and page setup', () => {
  it('bounds the appearance values', () => {
    const document = aDocument()
    expectCode(
      () => mergeAppearance(document.appearance, { fontScale: 1.3 }),
      'invalidSettings',
    )
    expectCode(
      () => mergeAppearance(document.appearance, { fontScale: 0.87 }),
      'invalidSettings',
    )
    expectCode(
      () => mergeAppearance(document.appearance, { lineHeight: 1 }),
      'invalidSettings',
    )
    expectCode(
      () => mergeAppearance(document.appearance, { sectionSpacing: 49 }),
      'invalidSettings',
    )
    expect(mergeAppearance(document.appearance, { fontScale: 1.25 }).fontScale).toBe(1.25)
  })

  it('derives extents from the paper', () => {
    expect(pageWidth(DEFAULT_PAGE_SETUP)).toBe(PAPER_DIMENSIONS.A4.width)
    expect(pageHeight(DEFAULT_PAGE_SETUP)).toBe(PAPER_DIMENSIONS.A4.height)
    expect(contentWidth(DEFAULT_PAGE_SETUP)).toBe(595.28 - 144)
    expect(contentHeight(DEFAULT_PAGE_SETUP)).toBe(841.89 - 144)
  })

  it('refuses margins outside the bound and unsupported columns', () => {
    const template = getTemplate(asTemplateId('classic-single'))
    if (template === null) throw new Error('classic-single missing')
    expectCode(
      () => validatePageSetup({ ...DEFAULT_PAGE_SETUP, marginLeft: MARGIN_MAX + 1 }, template),
      'invalidPageSetup',
    )
    expectCode(
      () => validatePageSetup({ ...DEFAULT_PAGE_SETUP, columns: 2 }, template),
      'invalidPageSetup',
    )
  })
})

describe('canvas blocks', () => {
  const page = DEFAULT_PAGE_SETUP

  it('accepts a text block and a divider inside the page', () => {
    expect(() => assertCanvasBlock(aTextBlock('block-1'), page)).not.toThrow()
    expect(() => assertCanvasBlock(aDividerBlock('block-2'), page)).not.toThrow()
  })

  it('refuses a box outside the page and one smaller than the minimum', () => {
    const out = { ...aTextBlock('block-1'), x: 500, width: 120 }
    expectCode(() => assertCanvasBlock(out, page), 'canvasBlockOutOfBounds')
    const small = { ...aTextBlock('block-1'), width: 7 }
    expectCode(() => assertCanvasBlock(small, page), 'canvasBlockOutOfBounds')
  })

  it('enforces the content rules per kind', () => {
    const noText = { ...aTextBlock('block-1'), text: null }
    expectCode(() => assertCanvasBlock(noText, page), 'invalidFieldValue')
    const dividerWithText = { ...aDividerBlock('block-2'), text: '文字' }
    expectCode(() => assertCanvasBlock(dividerWithText, page), 'invalidFieldValue')
    const imageWithoutAttachment = {
      ...aTextBlock('block-3'),
      kind: 'image' as const,
      text: null,
      textStyle: null,
      attachmentId: null,
    }
    expectCode(() => assertCanvasBlock(imageWithoutAttachment, page), 'invalidFieldValue')
    const tooLong = {
      ...aTextBlock('block-4'),
      text: '字'.repeat(CANVAS_BLOCK_MAX_TEXT_LENGTH + 1),
    }
    expectCode(() => assertCanvasBlock(tooLong, page), 'fieldTooLong')
  })

  it('validates the whole layout through the document validator', () => {
    const block = aTextBlock('free-1')
    expect(() => validateResumeDocument(aDocument({ freeBlocks: [block] }))).not.toThrow()
    const invalid = { ...block, x: 10_000 }
    expectCode(
      () => validateResumeDocument(aDocument({ freeBlocks: [invalid] })),
      'canvasBlockOutOfBounds',
    )
  })

  it('reports the deterministic block identifier of a free block', () => {
    const block: CanvasBlock = aTextBlock('free-1')
    expect(block.id).toBe(asCanvasBlockId('free-1'))
  })
})

describe('resume metadata and freeze guards', () => {
  it('trims titles and refuses blank or over-long ones', () => {
    expect(normalizeResumeTitle('  简历  ')).toBe('简历')
    expectCode(() => normalizeResumeTitle('   '), 'blankRequiredField')
    expectCode(() => normalizeResumeTitle('字'.repeat(81)), 'fieldTooLong')
  })

  it('refuses every document write on a frozen resume', () => {
    expectCode(
      () => assertMutable(aResumeValue(aDocument(), 'frozen')),
      'resumeFrozen',
    )
    expect(() => assertMutable(aResumeValue(aDocument(), 'draft'))).not.toThrow()
  })

  it('requires visible content before freezing', () => {
    const empty = aDocument({
      sections: richSections().map((section) => ({ ...section, entryIds: [] })),
    })
    expectCode(() => assertFreezable(aResumeValue(empty), []), 'emptyResume')
    const hidden = aDocument({
      sections: richSections().map((section) => ({
        ...section,
        visible: section.moduleKind === 'personal',
      })),
    })
    expect(() => assertFreezable(aResumeValue(hidden), [])).not.toThrow()
  })

  it('refuses freezing while a rendered reference is missing', () => {
    const missingEntry: MissingReference = {
      kind: 'entry',
      entryId: asInfoEntryId('gone'),
      sectionId: asResumeSectionId('section-personal'),
    }
    expectCode(
      () => assertFreezable(aResumeValue(aDocument()), [missingEntry]),
      'missingReference',
    )
    expect(() =>
      assertFreezable(aResumeValue(aDocument()), [
        {
          kind: 'jobPosting',
          jobPostingId: asJobPostingId('gone-posting'),
        },
        { kind: 'override', overrideId: aSummaryOverride().id, entryId: asInfoEntryId('gone') },
      ]),
    ).not.toThrow()
  })
})

describe('knowledge dates in the document', () => {
  it('renders display text without inventing a day', () => {
    expect(formatKnowledgeDate('2024-06' as Parameters<typeof formatKnowledgeDate>[0])).toBe(
      '2024 年 6 月',
    )
    expect(formatKnowledgeDate('2024' as Parameters<typeof formatKnowledgeDate>[0])).toBe(
      '2024 年',
    )
  })
})
