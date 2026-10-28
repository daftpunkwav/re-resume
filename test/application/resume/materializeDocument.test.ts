/**
 * @file materializeDocument.test
 * @description The single content exit: the header, the summary, the section and
 * entry mapping table, overrides, missing references, two-column placement, free
 * blocks and defensive truncation.
 */

import { describe, expect, it } from 'vitest'

import {
  HEADER_BLOCK_ID,
  MAX_BLOCK_PARAGRAPHS,
  MAX_PARAGRAPH_CODE_POINTS,
  SUMMARY_BLOCK_ID,
  layoutMaterializedDocument,
  materializeDocument,
  resolveStyles,
} from '../../../src/application/resume/materializeDocument'
import type { MaterializeInput } from '../../../src/application/resume/materializeDocument'
import type { LayoutBlock } from '../../../src/domain/resume/Layout'
import type { Resume } from '../../../src/domain/resume/Resume'
import { getTemplate } from '../../../src/domain/resume/Template'
import {
  asAttachmentId,
  asCustomModuleId,
  asInfoEntryId,
  asTemplateId,
} from '../../../src/domain/shared/branded-id'
import type {
  AppearanceSettings,
} from '../../../src/domain/resume/AppearanceSettings'
import {
  aDocument,
  aDividerBlock,
  aResume,
  aSection,
  aSummaryOverride,
  aTextBlock,
  aTwoColumnDocument,
  anEntryOverride,
  entriesMap,
  FixedWidthTextMeasurer,
  modulesMap,
  richSections,
} from '../../support/resumeFixtures'

const measurer = new FixedWidthTextMeasurer()
const classic = requireTemplate('classic-single')
const twoColumn = requireTemplate('two-column-sidebar')

function requireTemplate(id: string) {
  const template = getTemplate(asTemplateId(id))
  if (template === null) throw new Error(`fixture template ${id} missing`)
  return template
}

function toResume(document: ReturnType<typeof aDocument>): Resume {
  return aResume({ document }).resume
}

function materialize(resume: Resume, template = classic): ReturnType<typeof materializeDocument> {
  return materializeDocument({
    resume,
    entries: entriesMap(),
    customModules: modulesMap(),
    template,
    measurer,
  })
}

function blockById(blocks: readonly LayoutBlock[], id: string): LayoutBlock {
  const block = blocks.find((candidate) => candidate.id === id)
  if (block === undefined) throw new Error(`block ${id} missing from the document`)
  return block
}

function texts(block: LayoutBlock): readonly string[] {
  return block.paragraphs.map((paragraph) => paragraph.text)
}

describe('resolveStyles', () => {
  it('scales sizes by the appearance, rounds to half a point and floors at 8', () => {
    const appearance: AppearanceSettings = {
      ...classic.defaults.appearance,
      fontScale: 0.85,
      lineHeight: 1.7,
    }
    const styles = resolveStyles(classic.tokens, appearance)
    expect(styles.name.fontSize).toBe(17)
    expect(styles.entryBody.lineHeight).toBe(1.7)
    expect(styles.freeText.fontFamily).toBe(styles.name.fontFamily)
    const large: AppearanceSettings = { ...appearance, fontScale: 1.25 }
    const scaled = resolveStyles(classic.tokens, large)
    expect(scaled.sectionHeader.fontSize).toBe(15)
    for (const style of Object.values(scaled)) expect(style.fontSize).toBeGreaterThanOrEqual(8)
  })
})

describe('header and summary', () => {
  it('builds the header from the first personal entry', () => {
    const document = materialize(toResume(aDocument()))
    const header = blockById(document.blocks, HEADER_BLOCK_ID)
    expect(header.role).toBe('entry')
    expect(texts(header)[0]).toBe('林清越')
    expect(texts(header)).toContain('+86 138 0000 0000 · linqingyue@example.com · 上海 · qingyue_lin')
    expect(texts(header)).toContain('https://qingyue.example.com · https://github.com/qingyue')
  })

  it('places the summary between the header and the first section', () => {
    const document = aDocument({ overrides: [aSummaryOverride('岗位总结正文')] })
    const blocks = materialize(toResume(document)).blocks
    expect(blocks[0]?.id).toBe(HEADER_BLOCK_ID)
    expect(blocks[1]?.id).toBe(SUMMARY_BLOCK_ID)
    expect(blocks[2]?.role).toBe('sectionHeader')
    expect(texts(blockById(blocks, SUMMARY_BLOCK_ID))).toEqual(['岗位总结正文'])
  })

  it('reports a missing personal entry instead of losing the header silently', () => {
    const sections = richSections().map((section) =>
      section.moduleKind === 'personal'
        ? { ...section, entryIds: [asInfoEntryId('deleted-personal')] }
        : section,
    )
    const document = aDocument({ sections })
    const result = materialize(toResume(document))
    const header = blockById(result.blocks, HEADER_BLOCK_ID)
    expect(texts(header)).toEqual(['【缺失条目】'])
    expect(result.missingReferences).toContainEqual({
      kind: 'entry',
      entryId: 'deleted-personal',
      sectionId: sections[0]?.id,
    })
    expect(result.warnings).toContain('entry-missing')
  })
})

describe('sections and entries', () => {
  it('emits one header and one block per selected entry, in document order', () => {
    const result = materialize(toResume(aDocument()))
    const sectionBlocks = result.blocks.filter((block) => block.role === 'sectionHeader')
    // The personal chapter is represented by the header block, so it has no
    // section heading of its own.
    expect(sectionBlocks.map((block) => block.id)).toEqual(
      richSections()
        .filter((section) => section.moduleKind !== 'personal')
        .map((section) => `section:${section.id}`),
    )
    // The personal entry is represented by the header, not by an entry block.
    expect(result.blocks.some((block) => block.id === 'entry:preview-personal-1')).toBe(false)
    expect(blockById(result.blocks, 'entry:preview-skill-1').role).toBe('entry')
    expect(
      result.blocks.filter((block) => block.role === 'entry').length,
    ).toBeGreaterThan(10)
  })

  it('skips hidden chapters and uses the display name', () => {
    const sections = richSections().map((section) =>
      section.moduleKind === 'award'
        ? { ...section, visible: false }
        : section.moduleKind === 'skill'
          ? { ...section, displayName: '技术栈' }
          : section,
    )
    const result = materialize(toResume(aDocument({ sections })))
    expect(
      result.blocks.some((block) => block.id.startsWith('entry:preview-award')),
    ).toBe(false)
    const skillHeader = result.blocks.find(
      (block) => block.id === 'section:section-skill',
    )
    expect(skillHeader?.paragraphs[0]?.text).toBe('技术栈')
  })

  it('maps every information module to its heading, meta and body', () => {
    const blocks = materialize(toResume(aDocument())).blocks
    const education = blockById(blocks, 'entry:preview-education-1')
    expect(texts(education)[0]).toBe('复旦大学（硕士）')
    expect(texts(education)[1]).toBe('2021 年 9 月 - 至今 · 计算机技术')
    expect(education.paragraphs[2]?.bullet).toBe(true)
    expect(texts(education)).toContain('研究方向为分布式存储，参与实验室与企业的联合项目。')

    const internship = blockById(blocks, 'entry:preview-internship-1')
    expect(texts(internship)[0]).toBe('字节跳动 · 后端开发实习生')
    expect(texts(internship)[1]).toBe('2024 年 6 月 - 2025 年 1 月 · 电商中台 · 上海')
    expect(internship.paragraphs[2]?.bullet).toBe(true)
    expect(
      internship.paragraphs.some((paragraph) => paragraph.text.startsWith('成果：')),
    ).toBe(true)

    const project = blockById(blocks, 'entry:preview-project-1')
    expect(texts(project)[0]).toBe('订单中台重构（核心开发）')
    expect(texts(project)[1]).toBe(
      '2024 年 9 月 - 至今 · TypeScript, Node.js, PostgreSQL, Redis',
    )
    expect(texts(project)).toContain('https://github.com/qingyue/order-platform')

    const skill = blockById(blocks, 'entry:preview-skill-1')
    expect(texts(skill)).toEqual(['TypeScript（编程语言） · 精通'])

    const award = blockById(blocks, 'entry:preview-award-1')
    expect(texts(award)[0]).toBe('全国大学生数学建模竞赛二等奖（国家）')
    expect(texts(award)[1]).toBe('2020 年 11 月')

    const intent = blockById(blocks, 'entry:preview-job-intent-1')
    expect(texts(intent)[0]).toBe('后端开发工程师 · 上海 · 25-35K · 全职')
    expect(texts(intent)[1]).toBe('2026 年 7 月')

    const selfEvaluation = blockById(blocks, 'entry:preview-self-evaluation-1')
    expect(texts(selfEvaluation)[0]).not.toBe('')
    expect(texts(selfEvaluation).length).toBeGreaterThan(1)

    const custom = blockById(blocks, 'entry:preview-certificate-1')
    expect(texts(custom)[0]).toBe('CET-6')
    expect(texts(custom).some((text) => text.startsWith('证书名称：'))).toBe(true)
  })

  it('replaces the entry body with its override while keeping the heading', () => {
    const document = aDocument({
      overrides: [anEntryOverride('preview-project-1', '改写后的正文。')],
    })
    const project = blockById(
      materialize(toResume(document)).blocks,
      'entry:preview-project-1',
    )
    expect(texts(project)[0]).toBe('订单中台重构（核心开发）')
    expect(texts(project)).toContain('改写后的正文。')
    expect(texts(project)).not.toContain(
      '把单体订单服务拆分为可独立部署的领域服务，保持写入一致性与可追溯。',
    )
  })

  it('renders placeholders for missing entries and modules', () => {
    const sections = [
      ...richSections().map((section) =>
        section.moduleKind === 'project'
          ? { ...section, entryIds: [asInfoEntryId('deleted-project')] }
          : section,
      ).filter((section) => section.moduleKind !== 'custom'),
      aSection({
        moduleKind: 'custom',
        customModuleId: asCustomModuleId('deleted-module'),
        entryIds: [],
        id: 'missing-module-section',
        sortOrder: 9,
      }),
    ]
    const result = materialize(toResume(aDocument({ sections })))
    expect(
      texts(blockById(result.blocks, 'entry:deleted-project')),
    ).toEqual(['【缺失条目】'])
    expect(
      texts(blockById(result.blocks, 'section:missing-module-section')),
    ).toEqual(['模块已删除'])
    expect(result.missingReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'entry', entryId: 'deleted-project' }),
        expect.objectContaining({ kind: 'customModule', moduleId: 'deleted-module' }),
      ]),
    )
  })

  it('reports an override whose entry no longer exists', () => {
    const document = aDocument({
      overrides: [anEntryOverride('deleted-entry', '孤立文案')],
    })
    const result = materialize(toResume(document))
    expect(result.missingReferences).toEqual([
      expect.objectContaining({ kind: 'override', entryId: 'deleted-entry' }),
    ])
    expect(result.blocks.some((block) => block.id === 'entry:deleted-entry')).toBe(false)
  })

  it('reports a template the build does not carry and falls back', () => {
    const resume = toResume(aDocument())
    const withUnknownTemplate: Resume = {
      ...resume,
      document: { ...resume.document, templateId: asTemplateId('gone') },
    }
    const result = materialize(withUnknownTemplate)
    expect(result.missingReferences).toContainEqual({
      kind: 'template',
      templateId: 'gone',
    })
  })
})

describe('two-column placement', () => {
  it('marks sidebar chapters column 1, body chapters column 2 and orders the sidebar first', () => {
    const result = materialize(
      toResume(aTwoColumnDocument()),
      twoColumn ?? classic,
    )
    const header = blockById(result.blocks, HEADER_BLOCK_ID)
    expect(header.placement).toEqual({ mode: 'flow', columnSpan: 1, column: 1 })
    const skill = blockById(result.blocks, 'entry:preview-skill-1')
    expect(skill.placement).toEqual({ mode: 'flow', columnSpan: 1, column: 1 })
    const project = blockById(result.blocks, 'entry:preview-project-1')
    expect(project.placement).toEqual({ mode: 'flow', columnSpan: 1, column: 2 })
    const sidebarSkill = result.blocks.findIndex((block) => block.id === 'entry:preview-skill-1')
    const mainEducation = result.blocks.findIndex(
      (block) => block.id === 'entry:preview-education-1',
    )
    expect(sidebarSkill).toBeLessThan(mainEducation)
    const summary = blockById(result.blocks, SUMMARY_BLOCK_ID)
    expect(summary.placement).toEqual({ mode: 'flow', columnSpan: 1, column: 2 })
  })

  it('lays the two columns out as one page with both column offsets used', () => {
    const result = materialize(toResume(aTwoColumnDocument()), twoColumn ?? classic)
    const layout = layoutMaterializedDocument(
      {
        resume: toResume(aTwoColumnDocument()),
        entries: entriesMap(),
        customModules: modulesMap(),
        template: twoColumn ?? classic,
        measurer,
      },
      result.blocks,
    )
    expect(layout.pages).toHaveLength(1)
    const sidebar = layout.blocks.find((block) => block.blockId === 'entry:preview-skill-1')
    const main = layout.blocks.find((block) => block.blockId === 'entry:preview-project-1')
    expect(sidebar?.columnIndex).toBe(1)
    expect(main?.columnIndex).toBe(2)
    expect(main?.x).toBeGreaterThan(sidebar?.x ?? 0)
  })
})

describe('free blocks and truncation', () => {
  it('turns canvas blocks into absolute blocks in z-order', () => {
    const document = aDocument({
      freeBlocks: [aTextBlock('text-1', { x: 120, y: 200 }), aDividerBlock('divider-1')],
    })
    const result = materialize(toResume(document))
    const free = result.blocks.filter((block) => block.placement.mode === 'absolute')
    // The text block's zIndex is 0 and the divider's is 1, so the divider draws
    // above it and comes last in the draw order.
    expect(free.map((block) => block.id)).toEqual(['free:text-1', 'free:divider-1'])
    expect(free[1]?.role).toBe('divider')
    expect(free[1]?.image).toBeNull()
    expect(free[0]?.placement).toMatchObject({ mode: 'absolute', x: 120, y: 200 })
    expect(free[0]?.paragraphs[0]?.text).toBe('画布文字')
    expect(free[0]?.role).toBe('freeText')
  })

  it('keeps an image block role and its attachment', () => {
    const document = aDocument({
      freeBlocks: [
        {
          ...aTextBlock('image-1'),
          kind: 'image',
          text: null,
          textStyle: null,
          attachmentId: asAttachmentId('attachment-1'),
        },
      ],
    })
    const image = blockById(
      materialize(toResume(document)).blocks,
      'free:image-1',
    )
    expect(image.role).toBe('image')
    expect(image.image).toEqual({ attachmentId: 'attachment-1', width: 120, height: 30 })
  })

  it('truncates defensively and reports it', () => {
    const longParagraph = '字'.repeat(MAX_PARAGRAPH_CODE_POINTS + 10)
    const document = aDocument({
      freeBlocks: [
        {
          ...aTextBlock('free-many'),
          text: Array.from({ length: MAX_BLOCK_PARAGRAPHS + 1 }, () => '一行').join('\n'),
        },
      ],
    })
    // The override validator caps a stored summary at 4000 characters, which is
    // below the paragraph cap, so the long-paragraph case goes through a raw
    // materializer input: truncation is the materializer's own defence against a
    // value that reached it from outside the validated write path.
    const resume = toResume(document)
    const withLongOverride: Resume = {
      ...resume,
      document: {
        ...resume.document,
        overrides: [{ ...aSummaryOverride('短'), text: longParagraph }],
      },
    }
    const result = materialize(withLongOverride)
    const summary = blockById(result.blocks, SUMMARY_BLOCK_ID)
    expect(summary.paragraphs[0]?.text).toHaveLength(MAX_PARAGRAPH_CODE_POINTS)
    const free = blockById(result.blocks, 'free:free-many')
    expect(free.paragraphs).toHaveLength(MAX_BLOCK_PARAGRAPHS)
    expect(result.warnings).toContain('text-truncated')
  })
})

describe('layoutMaterializedDocument', () => {
  it('feeds the template column values into the layout', () => {
    const resume = toResume(aTwoColumnDocument())
    const input: MaterializeInput = {
      resume,
      entries: entriesMap(),
      customModules: modulesMap(),
      template: twoColumn ?? classic,
      measurer,
    }
    const document = materializeDocument(input)
    const layout = layoutMaterializedDocument(input, document.blocks)
    expect(layout.pages.length).toBeGreaterThan(0)
    expect(layout.overflows).toEqual([])
  })
})
