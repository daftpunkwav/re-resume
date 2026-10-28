/**
 * @file queriesAndFreeze.test
 * @description The read queries the interface uses — materialized document, page
 * count and overflow report, missing references — and the freeze transition with
 * its guards, snapshot and overflow report.
 */

import { describe, expect, it } from 'vitest'

import { checkLayoutOverflow } from '../../../src/application/resume/checkLayoutOverflow'
import { findMissingReferences } from '../../../src/application/resume/findMissingReferences'
import { freezeResume } from '../../../src/application/resume/freezeResume'
import { readMaterializedDocument } from '../../../src/application/resume/readMaterializedDocument'
import { setSectionSelection } from '../../../src/application/resume/setSectionSelection'
import { undoResumeChange } from '../../../src/application/resume/undoResumeChange'
import type { Resume } from '../../../src/domain/resume/Resume'
import type { Revision } from '../../../src/domain/resume/Revision'
import {
  asCustomModuleId,
  asInfoEntryId,
  asJobPostingId,
  asResumeOverrideId,
  asTemplateId,
} from '../../../src/domain/shared/branded-id'
import {
  aDocument,
  aResume,
  aSection,
  aSummaryOverride,
  aTextBlock,
  contentDeps,
  referenceDeps,
  richSections,
  TestLibrary,
  TestResumeStore,
} from '../../support/resumeFixtures'

describe('readMaterializedDocument', () => {
  it('returns the blocks, the page count and the missing references', async () => {
    const store = new TestResumeStore()
    const result = await readMaterializedDocument(contentDeps(store), {
      resumeId: store.resumeId,
    })
    expect(result.blocks.length).toBeGreaterThan(15)
    expect(result.pageCount).toBe(3)
    expect(result.missingReferences).toEqual([])
  })

  it('reports stale selections instead of throwing', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({
          sections: richSections().map((section) =>
            section.moduleKind === 'project'
              ? { ...section, entryIds: [asInfoEntryId('gone-project')] }
              : section,
          ),
        }),
      }),
    )
    const result = await readMaterializedDocument(contentDeps(store), {
      resumeId: store.resumeId,
    })
    expect(result.missingReferences).toEqual([
      expect.objectContaining({ kind: 'entry', entryId: 'gone-project' }),
    ])
  })
})

describe('checkLayoutOverflow', () => {
  it('reports the page count and an out-of-content free block', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({
          freeBlocks: [aTextBlock('margin-block', { x: 20, y: 20 })],
        }),
      }),
    )
    const result = await checkLayoutOverflow(contentDeps(store), {
      resumeId: store.resumeId,
    })
    expect(result.pageCount).toBe(3)
    expect(result.overflows).toEqual([
      {
        blockId: 'free:margin-block',
        pageIndex: 0,
        reason: 'absolute-out-of-bounds',
      },
    ])
  })
})

describe('findMissingReferences', () => {
  it('finds every reference kind in one report', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({
          sections: [
            ...richSections()
              .filter((section) => section.moduleKind !== 'custom')
              .map((section) =>
                section.moduleKind === 'project'
                  ? { ...section, entryIds: [asInfoEntryId('gone-project')] }
                  : section,
              ),
            aSection({
              moduleKind: 'custom',
              customModuleId: asCustomModuleId('gone-module'),
              entryIds: [],
              id: 'gone-module-section',
              sortOrder: 9,
            }),
          ],
          overrides: [
            aSummaryOverride('总结'),
            {
              ...aSummaryOverride('条目文案'),
              id: asResumeOverrideId('override-gone'),
              target: { kind: 'entry', entryId: asInfoEntryId('gone-entry') },
            },
          ],
        }),
      }),
    )
    const deps = referenceDeps(store, new TestLibrary())
    const missing = await findMissingReferences(deps, { resumeId: store.resumeId })
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'entry', entryId: 'gone-project' }),
        expect.objectContaining({ kind: 'customModule', moduleId: 'gone-module' }),
        expect.objectContaining({ kind: 'override', entryId: 'gone-entry' }),
      ]),
    )

    const base = aResume()
    const unknownTemplateResume: Resume = {
      ...base.resume,
      document: { ...aDocument(), templateId: asTemplateId('gone-template') },
      targetJob: {
        title: '岗位',
        company: null,
        jobPostingId: asJobPostingId('gone-posting'),
      },
    }
    const store2 = new TestResumeStore(seedCustomResume(unknownTemplateResume))
    const missing2 = await findMissingReferences(referenceDeps(store2), {
      resumeId: store2.resumeId,
    })
    expect(missing2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'template', templateId: 'gone-template' }),
        expect.objectContaining({ kind: 'jobPosting', jobPostingId: 'gone-posting' }),
      ]),
    )
  })
})

describe('freezeResume', () => {
  it('writes the snapshot that justifies the frozen status', async () => {
    const store = new TestResumeStore()
    const deps = referenceDeps(store)
    const result = await freezeResume(
      { ...deps, ids: store.ids, clock: store.clock },
      store.resumeId,
    )

    const frozen = await store.repository.findById(store.resumeId)
    expect(frozen?.status).toBe('frozen')
    expect(frozen?.snapshots).toHaveLength(1)
    expect(result.snapshot.seq).toBe(1)
    expect(result.snapshot.frozenState).toEqual(store.resume.document)
    expect(result.snapshot.materialized.blocks.length).toBeGreaterThan(15)
    expect(result.overflows).toEqual([])
    const stored = await store.repository.findSnapshotById(result.snapshot.id)
    expect(stored).toEqual(result.snapshot)
    // Freezing is a status transition, not a document edit: no revision.
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(1)
  })

  it('reports overflows without refusing the freeze', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({ freeBlocks: [aTextBlock('margin-block', { x: 10, y: 10 })] }),
      }),
    )
    const deps = referenceDeps(store)
    const result = await freezeResume(
      { ...deps, ids: store.ids, clock: store.clock },
      store.resumeId,
    )
    expect(result.overflows).toEqual([
      expect.objectContaining({ reason: 'absolute-out-of-bounds' }),
    ])
    expect((await store.repository.findById(store.resumeId))?.status).toBe('frozen')
  })

  it('refuses an empty document, a missing reference and a frozen resume', async () => {
    const empty = new TestResumeStore(
      aResume({
        document: aDocument({
          sections: richSections().map((section) => ({ ...section, entryIds: [] })),
        }),
      }),
    )
    await expect(
      freezeResume({ ...referenceDeps(empty), ids: empty.ids, clock: empty.clock }, empty.resumeId),
    ).rejects.toMatchObject({ code: 'emptyResume' })

    const stale = new TestResumeStore(
      aResume({
        document: aDocument({
          sections: richSections().map((section) =>
            section.moduleKind === 'award'
              ? { ...section, entryIds: [asInfoEntryId('gone')] }
              : section,
          ),
        }),
      }),
    )
    await expect(
      freezeResume({ ...referenceDeps(stale), ids: stale.ids, clock: stale.clock }, stale.resumeId),
    ).rejects.toMatchObject({ code: 'missingReference' })

    const frozen = new TestResumeStore(aResume({ status: 'frozen' }))
    await expect(
      freezeResume(
        { ...referenceDeps(frozen), ids: frozen.ids, clock: frozen.clock },
        frozen.resumeId,
      ),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
  })

  it('refuses to finalize a cursor that was moved back', async () => {
    const store = new TestResumeStore()
    const deps = { ...referenceDeps(store), ids: store.ids, clock: store.clock }
    await setSectionSelection(
      { resumes: store.repository, entries: deps.entries, ids: store.ids },
      {
        resumeId: store.resumeId,
        moduleKind: 'skill',
        entryIds: [asInfoEntryId('preview-skill-1')],
      },
    )
    await undoResumeChange({ resumes: store.repository }, store.resumeId)
    await expect(freezeResume(deps, store.resumeId)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
  })

  it('allows a deleted target posting and an orphan override to stay', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({
          overrides: [
            aSummaryOverride('总结'),
            {
              ...aSummaryOverride('孤立文案'),
              id: asResumeOverrideId('orphan-override'),
              target: { kind: 'entry', entryId: asInfoEntryId('gone-entry') },
            },
          ],
        }),
        targetJob: {
          title: '岗位',
          company: null,
          jobPostingId: asJobPostingId('gone-posting'),
        },
      }),
    )
    const deps = { ...referenceDeps(store), ids: store.ids, clock: store.clock }
    const result = await freezeResume(deps, store.resumeId)
    expect(result.snapshot.materialized.missingReferences).toEqual([
      expect.objectContaining({ kind: 'override' }),
    ])
    expect((await store.repository.findById(store.resumeId))?.status).toBe('frozen')
  })
})

/** Seeds a resume the fixture builder would reject (unknown template, posting). */
function seedCustomResume(resume: Resume): {
  readonly resume: Resume
  readonly revision: Revision
} {
  const base = aResume()
  const corrected: Resume = { ...resume, id: base.resume.id }
  return {
    resume: corrected,
    revision: { ...base.revision, state: corrected.document },
  }
}
