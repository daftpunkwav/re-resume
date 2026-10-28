/**
 * @file contextBlocks.test
 * @description Fitting the resume summary and library overview into their token
 * budgets: the contractual trimming order and the notes that make a cut visible.
 */

import { describe, expect, it } from 'vitest'

import {
  LIBRARY_OVERVIEW_MIN_TITLES,
  buildLibraryOverviewBlock,
  buildResumeContextBlock,
} from '../../../../src/application/generation/tools/contextBlocks'
import type { ResumeSummary } from '../../../../src/application/generation/tools/resumeSummary'
import { CONTEXT_BLOCK_TOKEN_BUDGET, estimateTokens } from '../../../../src/application/generation/context'
import type { CustomModuleDefinition } from '../../../../src/domain/info/CustomModule'
import type { MissingReference } from '../../../../src/domain/resume/MissingReference'
import type { AppearanceSettings } from '../../../../src/domain/resume/AppearanceSettings'
import type { PageSetup } from '../../../../src/domain/resume/PageSetup'
import {
  asCustomModuleId,
  asInfoEntryId,
  asResumeId,
  asResumeSectionId,
  asResumeOverrideId,
  asTemplateId,
  asCustomFieldKey,
} from '../../../../src/domain/shared/branded-id'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

const APPEARANCE: AppearanceSettings = {
  accentColor: 'ink',
  fontPairId: 'default',
  fontScale: 1,
  lineHeight: 1.5,
  sectionSpacing: 16,
  headingStyle: 'plain',
}

const PAGE_SETUP: PageSetup = {
  paper: 'A4',
  marginTop: 72,
  marginRight: 72,
  marginBottom: 72,
  marginLeft: 72,
  columns: 1,
  showPageNumber: false,
}

function summaryWith(overrides: Partial<ResumeSummary> = {}): ResumeSummary {
  return {
    resumeId: asResumeId('resume-1'),
    title: '后端开发工程师简历',
    status: 'draft',
    targetJob: { title: '后端开发工程师', company: '目标公司', jobPostingId: null },
    templateId: asTemplateId('classic-single'),
    appearance: APPEARANCE,
    pageSetup: PAGE_SETUP,
    sections: [
      {
        sectionId: asResumeSectionId('section-project'),
        moduleKind: 'project',
        customModuleId: null,
        displayName: null,
        visible: true,
        entryIds: [asInfoEntryId('entry-1')],
      },
    ],
    overrides: [
      {
        overrideId: asResumeOverrideId('override-1'),
        target: { kind: 'summary' },
        text: '三年后端开发经验。',
        origin: 'agent',
        editedByUser: false,
      },
    ],
    missingReferences: [] as readonly MissingReference[],
    freeBlockCount: 1,
    selectedEntryTitles: [
      { sectionId: asResumeSectionId('section-project'), titles: ['订单中台重构'] },
    ],
    ...overrides,
  }
}

describe('buildResumeContextBlock', () => {
  it('renders the metadata, the selected titles and the overrides when it fits', () => {
    const block = buildResumeContextBlock(summaryWith())
    expect(block).toContain('简历：后端开发工程师简历')
    expect(block).toContain('目标岗位：后端开发工程师 · 目标公司')
    expect(block).toContain('订单中台重构')
    expect(block).toContain('三年后端开发经验。')
    expect(estimateTokens(block)).toBeLessThanOrEqual(CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary)
  })

  it('drops the selected titles first when over budget', () => {
    const titles = Array.from({ length: 120 }, (_, index) => `项目标题${index.toString()}：性能优化与稳定性建设`)
    const block = buildResumeContextBlock(
      summaryWith({
        selectedEntryTitles: [
          { sectionId: asResumeSectionId('section-project'), titles },
        ],
      }),
    )
    expect(estimateTokens(block)).toBeLessThanOrEqual(CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary)
    expect(block).toContain('已省略部分已选条目标题')
    expect(block).not.toContain(titles[50])
  })

  it('shortens the tailored override text when dropping titles is not enough', () => {
    const block = buildResumeContextBlock(
      summaryWith({
        overrides: [
          {
            overrideId: asResumeOverrideId('override-1'),
            target: { kind: 'summary' },
            text: '长'.repeat(3000),
            origin: 'agent',
            editedByUser: false,
          },
        ],
      }),
    )
    expect(estimateTokens(block)).toBeLessThanOrEqual(CONTEXT_BLOCK_TOKEN_BUDGET.resumeSummary + 30)
    expect(block).toContain('截断定制文案')
  })
})

describe('buildLibraryOverviewBlock', () => {
  const customModule: CustomModuleDefinition = {
    id: asCustomModuleId('module-1'),
    name: '证书',
    fields: [
      { key: asCustomFieldKey('f_0c1a2b3c'), label: '名称', type: 'text', required: true, maxLength: 60 },
    ],
    sortOrder: 1,
    createdAt: AT,
    updatedAt: AT,
  }

  it('lists every module with its titles and no trimming note when it fits', () => {
    const block = buildLibraryOverviewBlock(
      new Map([
        ['personal:', ['林清越']],
        ['project:', ['订单中台重构', '数据看板']],
        ['custom:module-1', ['CET-6']],
      ]),
      [customModule],
      4,
    )
    expect(block).toContain('共 4 条信息')
    expect(block).toContain('个人信息：林清越')
    expect(block).toContain('证书：CET-6')
    expect(block).not.toContain('已按长度限制裁剪')
    expect(estimateTokens(block)).toBeLessThanOrEqual(CONTEXT_BLOCK_TOKEN_BUDGET.libraryOverview)
  })

  it('trims titles from the last module backwards and keeps the floor', () => {
    const projectTitles = Array.from(
      { length: 30 },
      (_, index) => `项目${index.toString()}：一个很长的项目标题，用来把概览推到预算之外`,
    )
    const certificateTitles = Array.from(
      { length: 30 },
      (_, index) => `证书${index.toString()}：一个很长的证书标题，用来把概览推到预算之外`,
    )
    const block = buildLibraryOverviewBlock(
      new Map([
        ['project:', projectTitles],
        ['custom:module-1', certificateTitles],
      ]),
      [customModule],
      60,
    )
    expect(estimateTokens(block)).toBeLessThanOrEqual(CONTEXT_BLOCK_TOKEN_BUDGET.libraryOverview)
    expect(block).toContain('已按长度限制裁剪')
    expect(projectTitles.length).toBeGreaterThanOrEqual(LIBRARY_OVERVIEW_MIN_TITLES)
  })
})
