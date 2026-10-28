/**
 * @file infoStore.test
 * @description The panel store's own contract: one library read populates the
 * panel, a write re-reads it, the selection is repaired when a module or entry
 * disappears, and an agent touch clears itself after two seconds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInfoService } from '../../../../src/bootstrap/wiring/info'
import { asResumeId, asResumeSectionId } from '../../../../src/domain/shared/branded-id'
import {
  customModuleFixture,
  infoEntryFixture,
} from '../../../support/infoFixtures'
import { newInfoLibrary, referencesFor } from '../../../support/infoLibrary'
import {
  AGENT_TOUCH_MS,
  resetInfoStore,
  useInfoStore,
} from '../../../../src/presentation/features/info/stores/infoStore'

function personalEntry(id: string) {
  return infoEntryFixture({
    id,
    moduleKind: 'personal',
    fields: { fullName: `姓名-${id}` },
  })
}

function educationEntry(id: string, sortOrder: number) {
  return infoEntryFixture({
    id,
    moduleKind: 'education',
    sortOrder,
    fields: {
      school: `学校-${id}`,
      degree: 'bachelor',
      startDate: '2017-09',
      endDate: '2021-06',
    },
  })
}

beforeEach(() => {
  resetInfoStore()
})

afterEach(() => {
  vi.useRealTimers()
  resetInfoStore()
})

describe('infoStore', () => {
  it('loads the library once and selects the first module', async () => {
    const library = newInfoLibrary({ entries: [personalEntry('p1'), educationEntry('e1', 1)] })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))

    await store.refresh()

    const state = useInfoStore.getState()
    expect(state.loading).toBe(false)
    expect(state.entries).toHaveLength(2)
    expect(state.summaries.map((summary) => summary.moduleKind)).toEqual([
      'personal',
      'education',
      'internship',
      'project',
      'skill',
      'award',
      'jobIntent',
      'selfEvaluation',
    ])
    expect(state.selectedModule).toEqual({ moduleKind: 'personal', customModuleId: null })
    expect(state.selectedEntryId).toBeNull()
  })

  it('repairs a selection that points at a deleted custom module', async () => {
    const module = customModuleFixture()
    const library = newInfoLibrary({
      entries: [
        personalEntry('p1'),
        infoEntryFixture({
          id: 'cert-1',
          moduleKind: 'custom',
          customModule: module,
          fields: { title: 'CET-6', f_11111111: '证书' },
        }),
      ],
      customModules: [module],
    })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()

    useInfoStore.getState().selectModule({ moduleKind: 'custom', customModuleId: module.id })
    await useInfoStore.getState().deleteCustomModule(module.id, true)

    expect(useInfoStore.getState().selectedModule).toEqual({
      moduleKind: 'personal',
      customModuleId: null,
    })
  })

  it('creates an entry and re-reads the library', async () => {
    const library = newInfoLibrary({ entries: [educationEntry('e1', 1)] })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()

    const output = await useInfoStore.getState().createEntry({
      moduleKind: 'skill',
      customModuleId: null,
      fields: { name: 'TypeScript' },
    })

    const state = useInfoStore.getState()
    expect(output.entry.title).toBe('TypeScript')
    expect(state.entries.some((entry) => entry.id === output.entry.id)).toBe(true)
    expect(state.summaries.find((summary) => summary.moduleKind === 'skill')?.entryCount).toBe(1)
  })

  it('updates an entry and keeps the module order', async () => {
    const library = newInfoLibrary({
      entries: [educationEntry('e1', 1), educationEntry('e2', 2)],
    })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()

    await useInfoStore.getState().updateEntry({
      entryId: useInfoStore.getState().entries[0]!.id,
      fields: {
        school: '新学校',
        degree: 'bachelor',
        startDate: '2017-09',
        endDate: '2021-06',
      },
    })

    const education = useInfoStore
      .getState()
      .entries.filter((entry) => entry.moduleKind === 'education')
    expect(education.map((entry) => entry.title)).toEqual(['新学校（本科）', '学校-e2（本科）'])
  })

  it('reorders the entries of a module', async () => {
    const library = newInfoLibrary({
      entries: [educationEntry('e1', 1), educationEntry('e2', 2)],
    })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()
    const ids = useInfoStore.getState().entries.map((entry) => entry.id)

    await useInfoStore.getState().reorderEntries({
      moduleKind: 'education',
      customModuleId: null,
      orderedEntryIds: [ids[1]!, ids[0]!],
    })

    const reversed = useInfoStore
      .getState()
      .entries.filter((entry) => entry.moduleKind === 'education')
    expect(reversed.map((entry) => entry.id)).toEqual([ids[1], ids[0]])
  })

  it('reports a reference refusal without pretending the entry is gone', async () => {
    const reference = {
      resumeId: asResumeId('resume-1'),
      resumeTitle: '后端工程师简历',
      sectionId: asResumeSectionId('section-1'),
    }
    const library = newInfoLibrary({
      entries: [personalEntry('p1')],
      entryReferences: referencesFor({ p1: [reference] }).byEntry,
    })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()

    await expect(
      useInfoStore.getState().deleteEntry(useInfoStore.getState().entries[0]!.id, false),
    ).rejects.toMatchObject({ code: 'entryReferenced' })
    expect(useInfoStore.getState().entries).toHaveLength(1)
  })

  it('marks an agent write and clears the highlight after two seconds', async () => {
    const library = newInfoLibrary({ entries: [personalEntry('p1')] })
    const store = useInfoStore.getState()
    store.connect(createInfoService(library.deps))
    await store.refresh()
    const entryId = useInfoStore.getState().entries[0]!.id

    vi.useFakeTimers()
    useInfoStore.getState().markAgentTouched([entryId], 'created')
    expect(useInfoStore.getState().agentTouched[entryId]).toBe('created')

    vi.advanceTimersByTime(AGENT_TOUCH_MS)
    expect(useInfoStore.getState().agentTouched[entryId]).toBeUndefined()
  })

  it('reports a failed read without throwing', async () => {
    const library = newInfoLibrary()
    const failing = {
      ...createInfoService(library.deps),
      listEntries: async () => {
        throw new Error('database is locked')
      },
    }
    useInfoStore.getState().connect(failing)

    await useInfoStore.getState().refresh()

    const state = useInfoStore.getState()
    expect(state.loading).toBe(false)
    expect(state.error).toEqual({ message: 'database is locked', blockers: [] })
  })
})
