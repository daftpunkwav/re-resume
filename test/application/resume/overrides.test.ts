/**
 * @file overrides.test
 * @description The customised-text use cases: the summary, entry overrides,
 * provenance transitions, deletion, and saving an override back into the shared
 * library through the information-library update use case.
 */

import { describe, expect, it } from 'vitest'

import { createInfoService } from '../../../src/bootstrap/wiring/info'
import { deleteOverride } from '../../../src/application/resume/deleteOverride'
import { saveOverrideToLibrary } from '../../../src/application/resume/saveOverrideToLibrary'
import { writeEntryOverride } from '../../../src/application/resume/writeEntryOverride'
import { writeSummaryOverride } from '../../../src/application/resume/writeSummaryOverride'
import { InMemoryEntryReferenceQuery } from '../../../src/infrastructure/preview/inMemoryInfoRepositories'
import { asAgentRunId, asInfoEntryId, asResumeOverrideId } from '../../../src/domain/shared/branded-id'
import { TestLibrary, TestResumeStore, aResume, anEntryOverride } from '../../support/resumeFixtures'

function overrideDeps(store: TestResumeStore) {
  return { resumes: store.repository, ids: store.ids, clock: store.clock }
}

function libraryService(library: TestLibrary, store: TestResumeStore) {
  return createInfoService({
    entries: library.entries,
    customModules: library.customModules,
    references: new InMemoryEntryReferenceQuery(),
    clock: store.clock,
    ids: store.ids,
  })
}

describe('writeSummaryOverride', () => {
  it('writes the summary as a user edit and keeps its identifier across rewrites', async () => {
    const store = new TestResumeStore()
    const first = await writeSummaryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      text: '  第一版总结  ',
    })
    expect(first.override.text).toBe('第一版总结')
    expect(first.override.origin).toBe('user')
    expect(first.override.editedByUser).toBe(true)
    expect(first.revision.label).toBe('撰写岗位总结')

    const second = await writeSummaryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      text: '第二版总结',
    })
    expect(second.override.id).toBe(first.override.id)
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.overrides).toHaveLength(1)
    expect(resume?.document.overrides[0]?.text).toBe('第二版总结')
  })

  it('keeps agent provenance when a user edits agent text', async () => {
    const store = new TestResumeStore()
    const agent = await writeSummaryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      text: 'Agent 总结',
      origin: 'agent',
      runId: asAgentRunId('run-1'),
    })
    expect(agent.override.origin).toBe('agent')
    expect(agent.override.sourceRunId).toBe('run-1')
    expect(agent.override.editedByUser).toBe(false)

    const edited = await writeSummaryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      text: '用户改过的总结',
    })
    expect(edited.override.id).toBe(agent.override.id)
    expect(edited.override.origin).toBe('agent')
    expect(edited.override.sourceRunId).toBe('run-1')
    expect(edited.override.editedByUser).toBe(true)
  })

  it('refuses an agent write without a run and over-long or blank text', async () => {
    const store = new TestResumeStore()
    await expect(
      writeSummaryOverride(overrideDeps(store), {
        resumeId: store.resumeId,
        text: '总结',
        origin: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })
    await expect(
      writeSummaryOverride(overrideDeps(store), {
        resumeId: store.resumeId,
        text: '字'.repeat(4001),
      }),
    ).rejects.toMatchObject({ code: 'fieldTooLong' })
    await expect(
      writeSummaryOverride(overrideDeps(store), {
        resumeId: store.resumeId,
        text: '   ',
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })
  })
})

describe('writeEntryOverride', () => {
  it('writes one override per entry and replaces it in place', async () => {
    const store = new TestResumeStore()
    const first = await writeEntryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      entryId: asInfoEntryId('preview-project-1'),
      text: '第一版改写',
    })
    const second = await writeEntryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      entryId: asInfoEntryId('preview-project-1'),
      text: '第二版改写',
    })
    expect(second.override.id).toBe(first.override.id)
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.overrides).toHaveLength(1)
    expect(second.revision.label).toBe('改写条目文案')
  })

  it('accepts an entry that no longer exists', async () => {
    const store = new TestResumeStore()
    const result = await writeEntryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      entryId: asInfoEntryId('deleted-entry'),
      text: '为已删除条目写下的文案',
    })
    expect(result.override.target).toEqual({
      kind: 'entry',
      entryId: asInfoEntryId('deleted-entry'),
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.overrides).toHaveLength(1)
  })
})

describe('deleteOverride', () => {
  it('removes one customised text', async () => {
    const store = new TestResumeStore()
    const fixture = anEntryOverride('preview-project-1')
    store.repository.seed([
      {
        resume: {
          ...aResume().resume,
          id: store.resumeId,
          document: {
            ...store.resume.document,
            overrides: [fixture],
          },
        },
        revision: aResume().revision,
      },
    ])
    await deleteOverride({ resumes: store.repository }, {
      resumeId: store.resumeId,
      overrideId: fixture.id,
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.overrides).toHaveLength(0)
  })

  it('refuses an unknown override', async () => {
    const store = new TestResumeStore()
    await expect(
      deleteOverride({ resumes: store.repository }, {
        resumeId: store.resumeId,
        overrideId: asResumeOverrideId('missing'),
      }),
    ).rejects.toMatchObject({ code: 'overrideNotFound' })
  })
})

describe('saveOverrideToLibrary', () => {
  async function anOverrideInPlace(store: TestResumeStore) {
    const written = await writeEntryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      entryId: asInfoEntryId('preview-internship-1'),
      text: '负责结算链路的端到端重构。',
    })
    return written.override
  }

  it('replaces the target field through the library use case', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const override = await anOverrideInPlace(store)
    const result = await saveOverrideToLibrary(
      {
        resumes: store.repository,
        entries: library.entries,
        customModules: library.customModules,
        updateEntry: libraryService(library, store).updateEntry,
        clock: store.clock,
      },
      {
        resumeId: store.resumeId,
        overrideId: override.id,
        targetFieldKey: 'responsibilities',
        mode: 'replace',
      },
    )
    expect(result.override.editedByUser).toBe(true)
    expect(result.revision.label).toBe('从简历保存回信息库')
    const entry = await library.entries.findById(asInfoEntryId('preview-internship-1'))
    expect(entry?.fields.responsibilities).toBe('负责结算链路的端到端重构。')
    expect(result.change.op).toBe('infoEntry.update')
  })

  it('appends once and does not duplicate the same text', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const override = await anOverrideInPlace(store)
    const deps = {
      resumes: store.repository,
      entries: library.entries,
      customModules: library.customModules,
      updateEntry: libraryService(library, store).updateEntry,
      clock: store.clock,
    }
    await saveOverrideToLibrary(deps, {
      resumeId: store.resumeId,
      overrideId: override.id,
      targetFieldKey: 'responsibilities',
      mode: 'append',
    })
    await saveOverrideToLibrary(deps, {
      resumeId: store.resumeId,
      overrideId: override.id,
      targetFieldKey: 'responsibilities',
      mode: 'append',
    })
    const entry = await library.entries.findById(asInfoEntryId('preview-internship-1'))
    const text = entry?.fields.responsibilities
    expect(typeof text).toBe('string')
    expect((text as string).split('\n').filter((line) => line === override.text)).toHaveLength(1)
  })

  it('refuses a summary target, an unknown field and a non-textarea field', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const deps = {
      resumes: store.repository,
      entries: library.entries,
      customModules: library.customModules,
      updateEntry: libraryService(library, store).updateEntry,
      clock: store.clock,
    }
    const summary = await writeSummaryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      text: '总结',
    })
    await expect(
      saveOverrideToLibrary(deps, {
        resumeId: store.resumeId,
        overrideId: summary.override.id,
        targetFieldKey: 'notes',
        mode: 'replace',
      }),
    ).rejects.toMatchObject({ code: 'unknownField' })

    const override = await anOverrideInPlace(store)
    await expect(
      saveOverrideToLibrary(deps, {
        resumeId: store.resumeId,
        overrideId: override.id,
        targetFieldKey: 'not-a-field',
        mode: 'replace',
      }),
    ).rejects.toMatchObject({ code: 'unknownField' })
    await expect(
      saveOverrideToLibrary(deps, {
        resumeId: store.resumeId,
        overrideId: override.id,
        targetFieldKey: 'company',
        mode: 'replace',
      }),
    ).rejects.toMatchObject({ code: 'unknownField' })
    await expect(
      saveOverrideToLibrary(deps, {
        resumeId: store.resumeId,
        overrideId: asResumeOverrideId('missing'),
        targetFieldKey: 'responsibilities',
        mode: 'replace',
      }),
    ).rejects.toMatchObject({ code: 'overrideNotFound' })
  })

  it('refuses an override whose entry is gone', async () => {
    const store = new TestResumeStore()
    const library = new TestLibrary()
    const written = await writeEntryOverride(overrideDeps(store), {
      resumeId: store.resumeId,
      entryId: asInfoEntryId('deleted-entry'),
      text: '孤立文案',
    })
    await expect(
      saveOverrideToLibrary(
        {
          resumes: store.repository,
          entries: library.entries,
          customModules: library.customModules,
          updateEntry: libraryService(library, store).updateEntry,
          clock: store.clock,
        },
        {
          resumeId: store.resumeId,
          overrideId: written.override.id,
          targetFieldKey: 'responsibilities',
          mode: 'replace',
        },
      ),
    ).rejects.toMatchObject({ code: 'entryNotFound' })
  })
})
