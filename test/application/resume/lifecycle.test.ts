/**
 * @file lifecycle.test
 * @description Creating, duplicating, renaming, retargeting and deleting a
 * resume: the metadata writes that stay out of the revision chain, the initial
 * document a template produces, and the initial revision the store receives.
 */

import { describe, expect, it } from 'vitest'

import { createResume } from '../../../src/application/resume/createResume'
import { deleteResume } from '../../../src/application/resume/deleteResume'
import { duplicateResume } from '../../../src/application/resume/duplicateResume'
import { renameResume } from '../../../src/application/resume/renameResume'
import { updateResumeTarget } from '../../../src/application/resume/updateResumeTarget'
import { asAgentRunId, asInfoEntryId, asResumeId, asTemplateId } from '../../../src/domain/shared/branded-id'
import { CANONICAL_SECTION_ORDER } from '../../../src/domain/resume/ResumeSection'
import { TestLibrary, TestResumeStore, aResume } from '../../support/resumeFixtures'
import type { DuplicateResumeDeps } from '../../../src/application/resume/duplicateResume'

function creationDeps(store: TestResumeStore, library: TestLibrary) {
  return {
    resumes: store.repository,
    entries: library.entries,
    customModules: library.customModules,
    ids: store.ids,
    clock: store.clock,
  }
}

function duplicateDeps(store: TestResumeStore): DuplicateResumeDeps {
  return { resumes: store.repository, ids: store.ids, clock: store.clock }
}

describe('createResume', () => {
  it('creates a draft with one empty chapter per built-in module and its first revision', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const created = await createResume(creationDeps(store, library), { title: '  新简历  ' })

    const resume = await store.repository.findById(created.resumeId)
    expect(resume).not.toBeNull()
    expect(resume?.title).toBe('新简历')
    expect(resume?.status).toBe('draft')
    expect(resume?.document.sections.map((section) => section.moduleKind)).toEqual(
      CANONICAL_SECTION_ORDER.filter((kind) => kind !== 'custom'),
    )
    for (const section of resume?.document.sections ?? []) {
      expect(section.entryIds).toEqual([])
      expect(section.visible).toBe(true)
      expect(section.displayName).toBeNull()
    }
    expect(resume?.document.templateId).toBe(asTemplateId('classic-single'))
    expect(resume?.document.appearance).toEqual(
      (await store.repository.findById(created.resumeId))?.document.appearance,
    )
    const revisions = await store.repository.listRevisions(created.resumeId)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.id).toBe(created.revisionId)
    expect(revisions[0]?.seq).toBe(1)
    expect(revisions[0]?.label).toBe('创建简历')
    expect(revisions[0]?.state).toEqual(resume?.document)
  })

  it('applies an initial selection and the template defaults', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const created = await createResume(creationDeps(store, library), {
      title: '双栏简历',
      templateId: asTemplateId('two-column-sidebar'),
      initialSelection: [
        { moduleKind: 'personal', entryIds: [asInfoEntryId('preview-personal-1')] },
        { moduleKind: 'education', entryIds: [asInfoEntryId('preview-education-1')] },
      ],
    })

    const resume = await store.repository.findById(created.resumeId)
    expect(resume?.document.pageSetup.columns).toBe(2)
    const personal = resume?.document.sections.find(
      (section) => section.moduleKind === 'personal',
    )
    expect(personal?.column).toBe(1)
    expect(personal?.entryIds).toEqual(['preview-personal-1'])
    const education = resume?.document.sections.find(
      (section) => section.moduleKind === 'education',
    )
    expect(education?.column).toBe(2)
    expect(education?.entryIds).toEqual(['preview-education-1'])
  })

  it('refuses a blank title, an unknown template and a bad initial selection', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const deps = creationDeps(store, library)

    await expect(createResume(deps, { title: '   ' })).rejects.toMatchObject({
      code: 'blankRequiredField',
    })
    await expect(
      createResume(deps, { title: '简历', templateId: asTemplateId('gone') }),
    ).rejects.toMatchObject({ code: 'templateNotFound' })
    await expect(
      createResume(deps, {
        title: '简历',
        initialSelection: [{ moduleKind: 'skill', entryIds: [asInfoEntryId('missing-entry')] }],
      }),
    ).rejects.toMatchObject({ code: 'entryNotFound' })
    await expect(
      createResume(deps, {
        title: '简历',
        initialSelection: [
          { moduleKind: 'skill', entryIds: [asInfoEntryId('preview-education-1')] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'moduleKindMismatch' })
  })

  it('records an agent-created resume with its run', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    await expect(
      createResume(creationDeps(store, library), {
        title: 'Agent 草稿',
        origin: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })

    const created = await createResume(creationDeps(store, library), {
      title: 'Agent 草稿',
      origin: 'agent',
      runId: asAgentRunId(store.revisionId),
    })
    const revisions = await store.repository.listRevisions(created.resumeId)
    expect(revisions[0]?.origin).toBe('agent')
    expect(revisions[0]?.runId).toBe(store.revisionId)
  })
})

describe('duplicateResume', () => {
  it('re-signs every structure identifier while keeping entry identifiers', async () => {
    const source = aResume({ id: 'source-resume', title: '原简历' })
    const store = new TestResumeStore(source)
    const created = await duplicateResume(duplicateDeps(store), {
      sourceResumeId: source.resume.id,
    })

    const copy = await store.repository.findById(created.resumeId)
    expect(copy?.title).toBe('原简历（副本）')
    expect(copy?.status).toBe('draft')
    expect(copy?.snapshots).toEqual([])
    const sourceSections = source.resume.document.sections
    const copySections = copy?.document.sections ?? []
    expect(copySections).toHaveLength(sourceSections.length)
    for (const [index, section] of copySections.entries()) {
      expect(section.id).not.toBe(sourceSections[index]?.id)
      expect(section.entryIds).toEqual(sourceSections[index]?.entryIds)
    }
    const revisions = await store.repository.listRevisions(created.resumeId)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.seq).toBe(1)
  })

  it('duplicates a frozen source and refuses an unknown template', async () => {
    const frozen = aResume({ id: 'frozen-source', status: 'frozen' })
    const store = new TestResumeStore(frozen)
    const created = await duplicateResume(duplicateDeps(store), {
      sourceResumeId: frozen.resume.id,
      title: '自定义副本',
    })
    expect((await store.repository.findById(created.resumeId))?.title).toBe('自定义副本')

    const unknownTemplateResume = {
      ...aResume({ id: 'unknown-template' }).resume,
      document: {
        ...aResume({ id: 'unknown-template' }).resume.document,
        templateId: asTemplateId('gone'),
      },
    }
    store.repository.seed([{ resume: unknownTemplateResume, revision: aResume().revision }])
    await expect(
      duplicateResume(duplicateDeps(store), {
        sourceResumeId: unknownTemplateResume.id,
      }),
    ).rejects.toMatchObject({ code: 'templateNotFound' })
  })

  it('refuses a source that does not exist', async () => {
    const store = new TestResumeStore()
    await expect(
      duplicateResume(duplicateDeps(store), {
        sourceResumeId: asResumeId('missing'),
      }),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })
})

describe('metadata writes', () => {
  it('renames without creating a revision', async () => {
    const store = new TestResumeStore()
    await renameResume({ resumes: store.repository, clock: store.clock }, {
      resumeId: store.resumeId,
      title: '  改名  ',
    })
    expect((await store.repository.findById(store.resumeId))?.title).toBe('改名')
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(1)
  })

  it('refuses a blank or over-long title', async () => {
    const store = new TestResumeStore()
    const deps = { resumes: store.repository, clock: store.clock }
    await expect(
      renameResume(deps, { resumeId: store.resumeId, title: '' }),
    ).rejects.toMatchObject({ code: 'blankRequiredField' })
    await expect(
      renameResume(deps, { resumeId: store.resumeId, title: '字'.repeat(81) }),
    ).rejects.toMatchObject({ code: 'fieldTooLong' })
  })

  it('writes and clears the target job without a revision', async () => {
    const store = new TestResumeStore()
    const deps = { resumes: store.repository, clock: store.clock }
    await updateResumeTarget(deps, {
      resumeId: store.resumeId,
      targetJob: { title: '  后端工程师 ', company: '', jobPostingId: null },
    })
    const saved = await store.repository.findById(store.resumeId)
    expect(saved?.targetJob).toEqual({
      title: '后端工程师',
      company: null,
      jobPostingId: null,
    })
    await updateResumeTarget(deps, { resumeId: store.resumeId, targetJob: null })
    expect((await store.repository.findById(store.resumeId))?.targetJob).toBeNull()
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(1)
  })

  it('refuses an over-long target title and a missing resume', async () => {
    const store = new TestResumeStore()
    const deps = { resumes: store.repository, clock: store.clock }
    await expect(
      updateResumeTarget(deps, {
        resumeId: store.resumeId,
        targetJob: { title: '字'.repeat(81), company: null, jobPostingId: null },
      }),
    ).rejects.toMatchObject({ code: 'fieldTooLong' })
    await expect(
      renameResume(deps, { resumeId: asResumeId('missing'), title: '简历' }),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })

  it('deletes a resume and reports a missing one', async () => {
    const store = new TestResumeStore()
    await deleteResume({ resumes: store.repository }, store.resumeId)
    expect(await store.repository.findById(store.resumeId)).toBeNull()
    await expect(
      deleteResume({ resumes: store.repository }, store.resumeId),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })
})
