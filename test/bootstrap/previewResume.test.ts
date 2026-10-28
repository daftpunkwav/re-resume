/**
 * @file previewResume.test
 * @description The preview composition root's resume service: seeded fixtures
 * are listed and readable, the layout query works without fonts, stale
 * references are reported, writes flow through the in-memory store, and the
 * library's reference question is answered from the fixture resumes.
 */

import { describe, expect, it } from 'vitest'

import { createPreviewRoot } from '../../src/bootstrap/previewRoot'
import {
  PREVIEW_CLASSIC_RESUME_ID,
  PREVIEW_MISSING_ENTRY_ID,
  PREVIEW_TWO_COLUMN_RESUME_ID,
} from '../../src/infrastructure/preview/fixtures.resume'
import { asInfoEntryId } from '../../src/domain/shared/branded-id'

describe('preview resume service', () => {
  it('lists the fixture resumes and lists the bundled templates', async () => {
    const root = createPreviewRoot()
    const resumes = await root.resume.listResumes()
    expect(resumes.map((resume) => resume.id)).toEqual([
      PREVIEW_CLASSIC_RESUME_ID,
      PREVIEW_TWO_COLUMN_RESUME_ID,
    ])
    expect(root.resume.listTemplates()).toHaveLength(6)
  })

  it('reads a materialized document and its page count without a font', async () => {
    const root = createPreviewRoot()
    const document = await root.resume.materializeDocument({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
    })
    expect(document.blocks.length).toBeGreaterThan(15)
    expect(document.pageCount).toBeGreaterThan(0)
    expect(document.missingReferences).toEqual([])
    const overflow = await root.resume.checkLayoutOverflow({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
    })
    expect(overflow.pageCount).toBe(document.pageCount)
    expect(overflow.overflows).toEqual([])
  })

  it('reports the stale references of the second sample', async () => {
    const root = createPreviewRoot()
    const missing = await root.resume.findMissingReferences({
      resumeId: PREVIEW_TWO_COLUMN_RESUME_ID,
    })
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'entry', entryId: PREVIEW_MISSING_ENTRY_ID }),
        expect.objectContaining({ kind: 'customModule', moduleId: 'preview-module-missing' }),
        expect.objectContaining({ kind: 'jobPosting', jobPostingId: 'preview-posting-missing' }),
      ]),
    )
    const document = await root.resume.materializeDocument({
      resumeId: PREVIEW_TWO_COLUMN_RESUME_ID,
    })
    expect(document.blocks.some((block) => block.role === 'freeText')).toBe(true)
    expect(document.missingReferences.length).toBeGreaterThan(0)
    // The sample is a clean layout: its free blocks sit inside the content box,
    // so a preview warning always means the user moved something.
    const overflow = await root.resume.checkLayoutOverflow({
      resumeId: PREVIEW_TWO_COLUMN_RESUME_ID,
    })
    expect(overflow.overflows).toEqual([])
  })

  it('writes through the preview store and keeps undo/redo local', async () => {
    const root = createPreviewRoot()
    const before = await root.resume.materializeDocument({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
    })
    await root.resume.setAppearance({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
      patch: { fontScale: 1.15 },
    })
    const after = await root.resume.materializeDocument({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
    })
    expect(after.pageCount).toBeGreaterThanOrEqual(before.pageCount)
    const revision = await root.resume.undo(PREVIEW_CLASSIC_RESUME_ID)
    expect(revision.seq).toBe(1)
    const restored = await root.resume.materializeDocument({
      resumeId: PREVIEW_CLASSIC_RESUME_ID,
    })
    expect(restored.pageCount).toBe(before.pageCount)
    // The other fixture is untouched.
    const other = await root.resume.materializeDocument({
      resumeId: PREVIEW_TWO_COLUMN_RESUME_ID,
    })
    expect(other.pageCount).toBeGreaterThan(0)
  })

  it('finalizes the complete sample and refuses the one with stale references', async () => {
    const root = createPreviewRoot()
    const frozen = await root.resume.freezeResume(PREVIEW_CLASSIC_RESUME_ID)
    expect(frozen.snapshot.frozenState.templateId).toBe('classic-single')
    expect(frozen.overflows).toEqual([])
    await expect(
      root.resume.freezeResume(PREVIEW_TWO_COLUMN_RESUME_ID),
    ).rejects.toMatchObject({ code: 'missingReference' })
  })

  it('answers the library reference question from the fixture resumes', async () => {
    const root = createPreviewRoot()
    const deleted = await root.info
      .deleteEntry({ entryId: asInfoEntryId('preview-skill-1'), confirmReferenced: false })
      .catch((failure: { code?: string }) => failure)
    expect((deleted as { code?: string }).code).toBe('entryReferenced')
  })
})

