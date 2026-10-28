/**
 * @file fixturesResume.test
 * @description The preview resume fixtures: both documents are valid, one
 * exercises every module and the other exercises the second template, overrides,
 * free blocks and stale references.
 */

import { describe, expect, it } from 'vitest'

import { validateResumeDocument } from '../../../src/domain/resume/DocumentState'
import {
  PREVIEW_CLASSIC_RESUME_ID,
  PREVIEW_MISSING_ENTRY_ID,
  PREVIEW_RESUMES,
  PREVIEW_TWO_COLUMN_RESUME_ID,
} from '../../../src/infrastructure/preview/fixtures.resume'
import { asTemplateId } from '../../../src/domain/shared/branded-id'

describe('preview resume fixtures', () => {
  it('ships two resumes that pass the document validator', () => {
    expect(PREVIEW_RESUMES).toHaveLength(2)
    for (const fixture of PREVIEW_RESUMES) {
      expect(() => validateResumeDocument(fixture.resume.document)).not.toThrow()
      expect(fixture.revision.state).toEqual(fixture.resume.document)
      expect(fixture.revision.seq).toBe(1)
      expect(fixture.resume.status).toBe('draft')
    }
    expect(PREVIEW_RESUMES.map((fixture) => fixture.resume.id)).toEqual([
      PREVIEW_CLASSIC_RESUME_ID,
      PREVIEW_TWO_COLUMN_RESUME_ID,
    ])
  })

  it('populates every information module in the classic sample', () => {
    const classic = PREVIEW_RESUMES[0]
    const kinds = classic?.resume.document.sections.map((section) => section.moduleKind)
    expect(kinds).toEqual([
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
    for (const section of classic?.resume.document.sections ?? []) {
      expect(section.entryIds.length).toBeGreaterThan(0)
    }
    expect(classic?.resume.document.overrides).toHaveLength(1)
  })

  it('exercises the sidebar template, overrides, free blocks and stale references', () => {
    const sample = PREVIEW_RESUMES[1]
    expect(sample?.resume.document.templateId).toBe(asTemplateId('two-column-sidebar'))
    expect(sample?.resume.document.pageSetup.columns).toBe(2)
    expect(sample?.resume.document.overrides.length).toBeGreaterThanOrEqual(2)
    expect(sample?.resume.document.canvas.freeBlocks.length).toBeGreaterThanOrEqual(2)
    const selected = sample?.resume.document.sections.flatMap((section) =>
      [...section.entryIds],
    )
    expect(selected).toContain(PREVIEW_MISSING_ENTRY_ID)
    expect(
      sample?.resume.document.sections.some(
        (section) => section.customModuleId === 'preview-module-missing',
      ),
    ).toBe(true)
    expect(sample?.resume.targetJob?.jobPostingId).toBe('preview-posting-missing')
  })
})
