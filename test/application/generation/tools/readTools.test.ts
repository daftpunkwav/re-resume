/**
 * @file readTools.test
 * @description The eight read tools against the memory library and resume store:
 * their success shapes, their refusals and their strict argument parsing.
 */

import { describe, expect, it } from 'vitest'

import type { JobPosting } from '../../../../src/domain/generation/JobPosting'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import { asJobPostingId } from '../../../../src/domain/shared/branded-id'
import { createToolBed, createToolConversation, invokeTool, toolContextOf } from '../../../support/toolBed'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

async function toolHarness() {
  const bed = createToolBed()
  const conversation = await createToolConversation(bed)
  const context = toolContextOf(bed, conversation)
  return { bed, conversation, context }
}

describe('searchInfoEntries', () => {
  it('returns hits with matched fields and a snippet', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'searchInfoEntries', { keyword: '订单' }, context)
    expect(result.ok).toBe(true)
    const value = result.value as { hits: { entryId: string; matchedOn: string[] }[] }
    expect(value.hits.length).toBeGreaterThan(0)
    expect(value.hits[0]?.matchedOn.length).toBeGreaterThan(0)
  })

  it('refuses a blank keyword at parse time', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'searchInfoEntries', { keyword: '   ' }, context)
    expect(result.ok).toBe(false)
    expect(result.parseError).toContain('keyword')
  })
})

describe('getInfoEntries', () => {
  it('reads the requested entries in order', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(
      bed,
      'getInfoEntries',
      { entryIds: ['preview-project-1', 'preview-project-2'] },
      context,
    )
    const value = result.value as { entries: { id: string }[] }
    expect(value.entries.map((entry) => entry.id)).toEqual([
      'preview-project-1',
      'preview-project-2',
    ])
  })

  it('reports an unknown identifier as a model-readable refusal', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'getInfoEntries', { entryIds: ['missing'] }, context)
    expect(result.value).toMatchObject({ ok: false, error: expect.stringContaining('entryNotFound') })
  })
})

describe('listInfoModules and listResumes', () => {
  it('lists modules with their counts and the custom module', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'listInfoModules', {}, context)
    const value = result.value as {
      modules: { moduleKind: string; entryCount: number }[]
      customModules: unknown[]
    }
    expect(value.modules.length).toBeGreaterThanOrEqual(9)
    expect(value.modules.find((module) => module.moduleKind === 'project')?.entryCount).toBeGreaterThan(0)
    expect(value.customModules).toHaveLength(1)
  })

  it('lists the stored resumes as metadata only', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'listResumes', {}, context)
    const value = result.value as { resumes: { title: string; status: string }[] }
    expect(value.resumes.map((resume) => resume.title)).toContain('后端开发工程师 · 林清越')
    expect(value.resumes.every((resume) => resume.status === 'draft')).toBe(true)
  })
})

describe('getResume and listTemplates', () => {
  it('returns the resume summary with selected titles and missing references', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(
      bed,
      'getResume',
      { resumeId: 'preview-resume-two-column' },
      context,
    )
    const value = result.value as {
      resumeId: string
      sections: { sectionId: string }[]
      selectedEntryTitles: { sectionId: string; titles: string[] }[]
      missingReferences: unknown[]
      freeBlockCount: number
    }
    expect(value.resumeId).toBe('preview-resume-two-column')
    expect(value.sections.length).toBeGreaterThan(0)
    expect(value.selectedEntryTitles.length).toBe(value.sections.length)
    expect(value.missingReferences.length).toBeGreaterThan(0)
    expect(value.freeBlockCount).toBeGreaterThanOrEqual(0)
  })

  it('refuses an unknown resume with resumeNotFound', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'getResume', { resumeId: 'missing' }, context)
    expect(result.value).toMatchObject({ ok: false, error: expect.stringContaining('resumeNotFound') })
  })

  it('lists the template registry with supported columns', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(bed, 'listTemplates', {}, context)
    const value = result.value as { templates: { templateId: string; columns: number[] }[] }
    expect(value.templates.length).toBeGreaterThan(0)
    expect(value.templates.every((template) => template.columns.length > 0)).toBe(true)
  })
})

describe('readJobPosting and checkLayoutOverflow', () => {
  it('reads a stored posting and reports an unknown one', async () => {
    const { bed, context } = await toolHarness()
    const posting: JobPosting = {
      id: asJobPostingId('posting-1'),
      rawText: '负责前端页面开发。',
      source: 'paste',
      imageAttachmentIds: [],
      conversationId: null,
      resumeId: null,
      parsed: null,
      parsedByRunId: null,
      parsedAt: null,
      createdAt: AT,
    }
    await bed.jobPostings.insert(posting)
    const found = await invokeTool(bed, 'readJobPosting', { jobPostingId: 'posting-1' }, context)
    expect(found.value).toMatchObject({ rawText: '负责前端页面开发。', imageCount: 0 })
    const missing = await invokeTool(bed, 'readJobPosting', { jobPostingId: 'nope' }, context)
    expect(missing.value).toMatchObject({ ok: false, error: expect.stringContaining('invalidFieldValue') })
  })

  it('reports the page count and overflows of a resume', async () => {
    const { bed, context } = await toolHarness()
    const result = await invokeTool(
      bed,
      'checkLayoutOverflow',
      { resumeId: 'preview-resume-classic' },
      context,
    )
    const value = result.value as { pageCount: number; overflows: unknown[] }
    expect(value.pageCount).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(value.overflows)).toBe(true)
  })
})

