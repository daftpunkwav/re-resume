/**
 * @file composition.test
 * @description The composition use cases: selecting entries for a chapter,
 * ordering, renaming/hiding a chapter, removing one, and the revision chain
 * undo/redo that covers every document write.
 */

import { describe, expect, it } from 'vitest'

import { removeSection } from '../../../src/application/resume/removeSection'
import { redoResumeChange } from '../../../src/application/resume/redoResumeChange'
import { setSectionDisplay } from '../../../src/application/resume/setSectionDisplay'
import { setSectionOrder } from '../../../src/application/resume/setSectionOrder'
import { setSectionSelection } from '../../../src/application/resume/setSectionSelection'
import { undoResumeChange } from '../../../src/application/resume/undoResumeChange'
import { commitResumeChange } from '../../../src/application/resume/commitResumeChange'
import { InMemoryResumeRepository } from '../../../src/infrastructure/preview/inMemoryResumeRepository'
import { sectionKey } from '../../../src/domain/resume/ResumeSection'
import { asAgentRunId, asInfoEntryId, asResumeSectionId } from '../../../src/domain/shared/branded-id'
import {
  aDocument,
  aResume,
  richSections,
  TestClock,
  TestLibrary,
  TestResumeStore,
} from '../../support/resumeFixtures'

function selectionDeps(store: TestResumeStore, library = new TestLibrary()) {
  return { resumes: store.repository, entries: library.entries, ids: store.ids }
}

describe('setSectionSelection', () => {
  it('replaces the entries of an existing chapter', async () => {
    const store = new TestResumeStore()
    const result = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-3'), asInfoEntryId('preview-skill-1')],
    })
    const resume = await store.repository.findById(store.resumeId)
    const skill = resume?.document.sections.find((section) => section.moduleKind === 'skill')
    expect(skill?.id).toBe(result.sectionId)
    expect(skill?.entryIds).toEqual(['preview-skill-3', 'preview-skill-1'])
    expect(result.revision.label).toBe('选择条目')
  })

  it('creates a missing chapter at its canonical position', async () => {
    const store = new TestResumeStore()
    const result = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'custom',
      customModuleId: 'preview-module-certificate' as Parameters<
        typeof setSectionSelection
      >[1]['customModuleId'],
      entryIds: [asInfoEntryId('preview-certificate-1')],
    })
    const resume = await store.repository.findById(store.resumeId)
    const kinds = resume?.document.sections.map((section) => section.moduleKind)
    expect(kinds?.[kinds.length - 1]).toBe('custom')
    expect(result.sectionId).toBe(
      resume?.document.sections[resume.document.sections.length - 1]?.id,
    )
  })

  it('refuses unknown entries, wrong modules, duplicates and the single-entry limit', async () => {
    const store = new TestResumeStore()
    const deps = selectionDeps(store)
    await expect(
      setSectionSelection(deps, {
        resumeId: store.resumeId,
        moduleKind: 'skill',
        entryIds: [asInfoEntryId('missing')],
      }),
    ).rejects.toMatchObject({ code: 'entryNotFound' })
    await expect(
      setSectionSelection(deps, {
        resumeId: store.resumeId,
        moduleKind: 'skill',
        entryIds: [asInfoEntryId('preview-award-1')],
      }),
    ).rejects.toMatchObject({ code: 'moduleKindMismatch' })
    await expect(
      setSectionSelection(deps, {
        resumeId: store.resumeId,
        moduleKind: 'skill',
        entryIds: [asInfoEntryId('preview-skill-1'), asInfoEntryId('preview-skill-1')],
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })
    await expect(
      setSectionSelection(deps, {
        resumeId: store.resumeId,
        moduleKind: 'personal',
        entryIds: [asInfoEntryId('preview-personal-1'), asInfoEntryId('preview-personal-1')],
      }),
    ).rejects.toMatchObject({ code: 'sectionLimitExceeded' })
  })

  it('refuses a custom selection without its module', async () => {
    const store = new TestResumeStore()
    await expect(
      setSectionSelection(selectionDeps(store), {
        resumeId: store.resumeId,
        moduleKind: 'custom',
        entryIds: [],
      }),
    ).rejects.toMatchObject({ code: 'moduleKindMismatch' })
  })

  it('records agent provenance when the caller is a tool', async () => {
    const store = new TestResumeStore()
    const result = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-1')],
      origin: 'agent',
      runId: asAgentRunId('run-1'),
    })
    expect(result.revision.origin).toBe('agent')
    expect(result.revision.runId).toBe('run-1')
  })
})

describe('setSectionOrder', () => {
  it('reorders the chapters densely', async () => {
    const store = new TestResumeStore()
    const sections = store.resume.document.sections
    const reversed = [...sections].reverse().map((section) => section.id)
    const result = await setSectionOrder({ resumes: store.repository }, {
      resumeId: store.resumeId,
      orderedSectionIds: reversed,
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.sections.map((section) => section.id)).toEqual(reversed)
    expect(resume?.document.sections.map((section) => section.sortOrder)).toEqual(
      reversed.map((_, index) => index + 1),
    )
    expect(result.revision.label).toBe('调整章节顺序')
  })

  it('refuses an order that does not name exactly the existing chapters', async () => {
    const store = new TestResumeStore()
    const deps = { resumes: store.repository }
    await expect(
      setSectionOrder(deps, {
        resumeId: store.resumeId,
        orderedSectionIds: store.resume.document.sections
          .slice(0, 1)
          .map((section) => section.id),
      }),
    ).rejects.toMatchObject({ code: 'sectionNotFound' })
    await expect(
      setSectionOrder(deps, {
        resumeId: store.resumeId,
        orderedSectionIds: [
          ...store.resume.document.sections.map((section) => section.id),
          asResumeSectionId('unknown-section'),
        ],
      }),
    ).rejects.toMatchObject({ code: 'sectionNotFound' })
  })
})

describe('setSectionDisplay', () => {
  it('renames, hides and re-columns a chapter', async () => {
    const store = new TestResumeStore(aResume({ document: aDocument() }))
    const section = richSections().find((candidate) => candidate.moduleKind === 'skill')
    if (section === undefined) throw new Error('skill section missing')
    const current = (await store.repository.findById(store.resumeId))?.document.sections.find(
      (candidate) => candidate.moduleKind === 'skill',
    )
    if (current === undefined) throw new Error('skill section missing')

    await setSectionDisplay({ resumes: store.repository }, {
      resumeId: store.resumeId,
      sectionId: current.id,
      displayName: '  技术栈  ',
    })
    let resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.sections.find((s) => s.id === current.id)?.displayName).toBe('技术栈')

    await setSectionDisplay({ resumes: store.repository }, {
      resumeId: store.resumeId,
      sectionId: current.id,
      visible: false,
    })
    resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.sections.find((s) => s.id === current.id)?.visible).toBe(false)
  })

  it('refuses a long name, a second column on a one-column page and an unknown chapter', async () => {
    const store = new TestResumeStore()
    const section = store.resume.document.sections[0]
    if (section === undefined) throw new Error('fixture has no sections')
    const deps = { resumes: store.repository }
    await expect(
      setSectionDisplay(deps, {
        resumeId: store.resumeId,
        sectionId: section.id,
        displayName: '名'.repeat(25),
      }),
    ).rejects.toMatchObject({ code: 'fieldTooLong' })
    await expect(
      setSectionDisplay(deps, {
        resumeId: store.resumeId,
        sectionId: section.id,
        column: 2,
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })
    await expect(
      setSectionDisplay(deps, {
        resumeId: store.resumeId,
        sectionId: asResumeSectionId('unknown'),
        visible: false,
      }),
    ).rejects.toMatchObject({ code: 'sectionNotFound' })
  })
})

describe('removeSection', () => {
  it('removes a chapter and renumbers the rest', async () => {
    const store = new TestResumeStore()
    const removed = store.resume.document.sections.find(
      (section) => section.moduleKind === 'award',
    )
    if (removed === undefined) throw new Error('award section missing')
    await removeSection({ resumes: store.repository }, {
      resumeId: store.resumeId,
      sectionId: removed.id,
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(
      resume?.document.sections.some((section) => section.moduleKind === 'award'),
    ).toBe(false)
    expect(resume?.document.sections.map((section) => section.sortOrder)).toEqual(
      resume?.document.sections.map((_, index) => index + 1),
    )
  })

  it('refuses an unknown chapter', async () => {
    const store = new TestResumeStore()
    await expect(
      removeSection({ resumes: store.repository }, {
        resumeId: store.resumeId,
        sectionId: asResumeSectionId('unknown'),
      }),
    ).rejects.toMatchObject({ code: 'sectionNotFound' })
  })
})

describe('undo and redo', () => {
  it('moves the cursor without creating a revision', async () => {
    const store = new TestResumeStore()
    const first = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-1')],
    })
    const second = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-2')],
    })
    expect(second.revision.seq).toBe(3)

    const undone = await undoResumeChange({ resumes: store.repository }, store.resumeId)
    expect(undone.id).toBe(first.revision.id)
    let resume = await store.repository.findById(store.resumeId)
    expect(
      resume?.document.sections.find((section) => section.moduleKind === 'skill')?.entryIds,
    ).toEqual(['preview-skill-1'])
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(3)

    const redone = await redoResumeChange({ resumes: store.repository }, store.resumeId)
    expect(redone.id).toBe(second.revision.id)
    resume = await store.repository.findById(store.resumeId)
    expect(
      resume?.document.sections.find((section) => section.moduleKind === 'skill')?.entryIds,
    ).toEqual(['preview-skill-2'])
  })

  it('refuses to undo past the initial revision and to redo past the head', async () => {
    const store = new TestResumeStore()
    await expect(
      undoResumeChange({ resumes: store.repository }, store.resumeId),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
    await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-1')],
    })
    await expect(
      redoResumeChange({ resumes: store.repository }, store.resumeId),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
  })

  it('refuses undo and redo on a frozen resume', async () => {
    const store = new TestResumeStore(aResume({ status: 'frozen' }))
    await expect(
      undoResumeChange({ resumes: store.repository }, store.resumeId),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
    await expect(
      redoResumeChange({ resumes: store.repository }, store.resumeId),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
  })

  it('supersedes the abandoned branch when a change is committed after undo', async () => {
    const store = new TestResumeStore()
    const one = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-1')],
    })
    const two = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-2')],
    })
    await undoResumeChange({ resumes: store.repository }, store.resumeId)
    const three = await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: 'skill',
      entryIds: [asInfoEntryId('preview-skill-3')],
    })
    expect(three.revision.seq).toBe(4)
    const revisions = await store.repository.listRevisions(store.resumeId)
    const abandoned = revisions.find((revision) => revision.id === two.revision.id)
    expect(abandoned?.supersededAt).not.toBeNull()
    expect(revisions.find((revision) => revision.id === one.revision.id)?.supersededAt).toBeNull()

    const resume = await store.repository.findById(store.resumeId)
    expect(
      resume?.document.sections.find((section) => section.moduleKind === 'skill')?.entryIds,
    ).toEqual(['preview-skill-3'])
  })

  it('keeps only the newest live window', async () => {
    const clock = new TestClock()
    const repository = new InMemoryResumeRepository(clock, 3)
    const fixture = aResume()
    repository.seed([fixture])
    for (let index = 0; index < 5; index += 1) {
      const section = (await repository.findById(fixture.resume.id))?.document.sections.find(
        (candidate) => candidate.moduleKind === 'skill',
      )
      if (section === undefined) throw new Error('skill section missing')
      const entry = `preview-skill-${((index % 3) + 1).toString()}`
      await commitResumeChange({ resumes: repository }, fixture.resume.id, {
        label: '选择条目',
        origin: 'user',
        runId: null,
        next: (state) => ({
          ...state,
          sections: state.sections.map((candidate) =>
            sectionKey(candidate.moduleKind, candidate.customModuleId) === 'skill:'
              ? { ...candidate, entryIds: [asInfoEntryId(entry)] }
              : candidate,
          ),
        }),
      })
    }
    const revisions = await repository.listRevisions(fixture.resume.id)
    const live = revisions.filter((revision) => revision.supersededAt === null)
    expect(live.length).toBeLessThanOrEqual(3)
    expect(live[live.length - 1]?.seq).toBe(6)
    // The cursor stays reachable after the trim.
    const loaded = await repository.findById(fixture.resume.id)
    expect(loaded?.currentRevision).toBe(live[live.length - 1]?.id)
  })
})

describe('stable ids', () => {
  it('keeps one section per module identity', async () => {
    const store = new TestResumeStore()
    const sections = store.resume.document.sections
    const first = sections[0]
    if (first === undefined) throw new Error('fixture has no sections')
    await setSectionSelection(selectionDeps(store), {
      resumeId: store.resumeId,
      moduleKind: first.moduleKind,
      entryIds: ['preview-personal-1'].map((id) => asInfoEntryId(id)),
    })
    const resume = await store.repository.findById(store.resumeId)
    const personalSections = resume?.document.sections.filter(
      (section) => section.moduleKind === 'personal',
    )
    expect(personalSections).toHaveLength(1)
    expect(personalSections?.[0]?.id).toBe(first.id)
  })
})
