/**
 * @file commitResumeChange.test
 * @description The single document write entry: the load/freeze guard order, the
 * validation of the produced state, and the revision the repository appends.
 */

import { describe, expect, it } from 'vitest'

import { commitResumeChange } from '../../../src/application/resume/commitResumeChange'
import { aDocument, aResume, aSection, TestResumeStore } from '../../support/resumeFixtures'
import { richSections } from '../../support/resumeFixtures'
import type { DocumentChange } from '../../../src/domain/resume/DocumentState'
import { asInfoEntryId } from '../../../src/domain/shared/branded-id'

function aChange(next: DocumentChange['next']): DocumentChange {
  return { label: '测试变更', origin: 'user', runId: null, next }
}

describe('commitResumeChange', () => {
  it('appends one revision and moves the cursor', async () => {
    const store = new TestResumeStore()
    const revision = await commitResumeChange({ resumes: store.repository }, store.resumeId, aChange(
      (state) => ({
        ...state,
        sections: state.sections.map((section) =>
          section.moduleKind === 'skill'
            ? { ...section, entryIds: [asInfoEntryId('preview-skill-1')] }
            : section,
        ),
      }),
    ))

    expect(revision.seq).toBe(2)
    expect(revision.label).toBe('测试变更')
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(2)
    const updated = await store.repository.findById(store.resumeId)
    expect(updated?.currentRevision).toBe(revision.id)
  })

  it('refuses a missing resume', async () => {
    const store = new TestResumeStore()
    await expect(
      commitResumeChange(
        { resumes: store.repository },
        'missing-resume' as Parameters<typeof commitResumeChange>[2] extends never
          ? never
          : Parameters<typeof commitResumeChange>[1],
        aChange((state) => state),
      ),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })

  it('refuses a frozen resume before evaluating the change', async () => {
    const store = new TestResumeStore(aResume({ status: 'frozen' }))
    let evaluated = false
    await expect(
      commitResumeChange({ resumes: store.repository }, store.resumeId, aChange((state) => {
        evaluated = true
        return state
      })),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
    expect(evaluated).toBe(false)
  })

  it('refuses a state that violates the document invariants and writes nothing', async () => {
    const store = new TestResumeStore()
    await expect(
      commitResumeChange({ resumes: store.repository }, store.resumeId, aChange((state) => ({
        ...state,
        sections: [...state.sections, aSection({ moduleKind: 'skill' })],
      }))),
    ).rejects.toMatchObject({ code: 'duplicateSection' })
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(1)
    const unchanged = await store.repository.findById(store.resumeId)
    expect(unchanged?.currentRevision).toBe(store.revisionId)
  })

  it('allows a state whose references are stale, so they can be cleared', async () => {
    const store = new TestResumeStore()
    const revision = await commitResumeChange({ resumes: store.repository }, store.resumeId, aChange(
      (state) => ({
        ...state,
        sections: state.sections.map((section) =>
          section.moduleKind === 'award'
            ? { ...section, entryIds: [asInfoEntryId('deleted-entry')] }
            : section,
        ),
      }),
    ))
    expect(revision.seq).toBe(2)
    // Clearing it again must also be committable.
    const cleared = await commitResumeChange({ resumes: store.repository }, store.resumeId, aChange(
      (state) => ({
        ...state,
        sections: state.sections.map((section) =>
          section.moduleKind === 'award' ? { ...section, entryIds: [] } : section,
        ),
      }),
    ))
    expect(cleared.seq).toBe(3)
  })

  it('records agent provenance from the change', async () => {
    const store = new TestResumeStore()
    const revision = await commitResumeChange({ resumes: store.repository }, store.resumeId, {
      label: 'Agent 写入',
      origin: 'agent',
      runId: 'run-1' as Parameters<DocumentChange['next']>[0] extends never
        ? never
        : NonNullable<DocumentChange['runId']>,
      next: (state) => ({ ...state, sections: richSections() }),
    })
    expect(revision.origin).toBe('agent')
    expect(revision.runId).toBe('run-1')
  })

  it('keeps the document state exactly as the change produced it', async () => {
    const store = new TestResumeStore()
    const next = aDocument({ sections: richSections().filter((section) => section.visible) })
    const revision = await commitResumeChange({ resumes: store.repository }, store.resumeId, {
      label: '重写文档',
      origin: 'user',
      runId: null,
      next: () => next,
    })
    const loaded = await store.repository.findById(store.resumeId)
    expect(loaded?.document).toEqual(next)
    expect(revision.state).toEqual(next)
  })
})
