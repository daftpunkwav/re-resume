/**
 * @file infoEntries.test
 * @description The entry use cases end to end over the in-memory library: order
 * assignment, title derivation, provenance, deletion protection through the
 * injected reference query, dense reordering and the change record each write
 * appends.
 */

import { describe, expect, it } from 'vitest'

import { createInfoEntry } from '../../../src/application/info/createInfoEntry'
import { deleteInfoEntry } from '../../../src/application/info/deleteInfoEntry'
import { listInfoEntries } from '../../../src/application/info/listInfoEntries'
import { reorderInfoEntries } from '../../../src/application/info/reorderInfoEntries'
import { updateInfoEntry } from '../../../src/application/info/updateInfoEntry'
import {
  asAgentRunId,
  asCustomModuleId,
  asInfoEntryId,
  asResumeId,
  asResumeSectionId,
} from '../../../src/domain/shared/branded-id'
import type { InfoEntry } from '../../../src/domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../../src/domain/info/CustomModule'
import {
  customModuleFixture,
  FIXTURE_TIME,
  infoEntryFixture,
  validRawFields,
} from '../../support/infoFixtures'
import { newInfoLibrary, referencesFor } from '../../support/infoLibrary'
import { expectDomainErrorAsync } from '../../support/domainErrors'
import type { TestInfoLibrary } from '../../support/infoLibrary'
import { parseDateTime } from '../../../src/domain/shared/DateTime'

const RESUME_ID = asResumeId('resume-1')
const SECTION_ID = asResumeSectionId('section-1')

function projectEntry(id: string, sortOrder: number, name = '订单中台'): InfoEntry {
  return infoEntryFixture({
    id,
    moduleKind: 'project',
    fields: validRawFields('project', { name }),
    sortOrder,
  })
}

/** Parses a JSON change payload; the payloads are opaque text to the library. */
function payload(change: { readonly beforeJson: string | null }): unknown {
  return change.beforeJson === null ? null : JSON.parse(change.beforeJson)
}

describe('createInfoEntry', () => {
  it('appends the entry at the end of its module and records the change', async () => {
    const library = newInfoLibrary()

    const result = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project'),
      origin: 'user',
      conversationId: null,
    })

    expect(result.entry).toMatchObject({
      id: 'id-1',
      moduleKind: 'project',
      customModuleId: null,
      title: '订单中台',
      sortOrder: 1,
      origin: 'user',
      sourceRunId: null,
    })
    expect(result.entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.entry.updatedAt).toBe(result.entry.createdAt)
    await expect(library.entries.findById(result.entry.id)).resolves.toEqual(result.entry)

    expect(result.change).toMatchObject({
      id: 'id-2',
      scope: 'library',
      entity: 'infoEntry',
      entityId: result.entry.id,
      op: 'infoEntry.create',
      beforeJson: null,
      origin: 'user',
      runId: null,
      conversationId: null,
      label: '新增项目经历：订单中台',
      undoneAt: null,
    })
    expect(JSON.parse(result.change.afterJson ?? 'null')).toEqual(result.entry)
    expect(library.changes.all()).toHaveLength(1)
  })

  it('numbers the entries 1..n and keeps a deletion gap', async () => {
    const library = newInfoLibrary()
    const first = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '一' }),
      origin: 'user',
    })
    const second = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '二' }),
      origin: 'user',
    })
    const third = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '三' }),
      origin: 'user',
    })
    expect([first.entry.sortOrder, second.entry.sortOrder, third.entry.sortOrder]).toEqual([1, 2, 3])

    await deleteInfoEntry(library.deps, { entryId: second.entry.id, confirmReferenced: true })
    const fourth = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '四' }),
      origin: 'user',
    })

    expect(fourth.entry.sortOrder).toBe(4)
  })

  it('derives the title for a custom module entry', async () => {
    const custom = customModuleFixture()
    const library = newInfoLibrary({ customModules: [custom] })

    const result = await createInfoEntry(library.deps, {
      moduleKind: 'custom',
      customModuleId: custom.id,
      fields: { title: 'CET-6', f_11111111: '大学英语六级' },
      origin: 'user',
    })

    expect(result.entry.title).toBe('CET-6')
    expect(result.change.label).toBe('新增证书：CET-6')
    expect(result.entry.customModuleId).toBe(custom.id)
  })

  it('refuses a custom entry without its module and a built-in entry with one', async () => {
    const custom = customModuleFixture()
    const library = newInfoLibrary({ customModules: [custom] })

    await expectDomainErrorAsync(
      createInfoEntry(library.deps, {
        moduleKind: 'custom',
        customModuleId: null,
        fields: { title: 'x' },
        origin: 'user',
      }),
      'moduleKindMismatch',
    )
    await expectDomainErrorAsync(
      createInfoEntry(library.deps, {
        moduleKind: 'project',
        customModuleId: custom.id,
        fields: validRawFields('project'),
        origin: 'user',
      }),
      'moduleKindMismatch',
    )
    await expectDomainErrorAsync(
      createInfoEntry(library.deps, {
        moduleKind: 'custom',
        customModuleId: asCustomModuleId('missing-module'),
        fields: { title: 'x' },
        origin: 'user',
      }),
      'customModuleNotFound',
    )
  })

  it('refuses a field the module does not declare', async () => {
    const library = newInfoLibrary()
    const error = await expectDomainErrorAsync(
      createInfoEntry(library.deps, {
        moduleKind: 'project',
        fields: { ...validRawFields('project'), unknown: 'x' },
        origin: 'user',
      }),
      'unknownField',
    )
    expect(error.detail?.blockers).toEqual(['unknown'])
  })

  it('requires an agent write to name the run it came from', async () => {
    const library = newInfoLibrary()
    await expectDomainErrorAsync(
      createInfoEntry(library.deps, {
        moduleKind: 'project',
        fields: validRawFields('project'),
        origin: 'agent',
      }),
      'invalidFieldValue',
    )

    const result = await createInfoEntry(library.deps, {
      moduleKind: 'project',
      fields: validRawFields('project'),
      origin: 'agent',
      sourceRunId: asAgentRunId('run-1'),
    })
    expect(result.entry.origin).toBe('agent')
    expect(result.entry.sourceRunId).toBe('run-1')
    expect(result.change.origin).toBe('agent')
    expect(result.change.runId).toBe('run-1')
  })
})

describe('updateInfoEntry', () => {
  it('replaces the field record, keeps identity fields and re-derives the title', async () => {
    const original = infoEntryFixture({
      id: 'entry-1',
      moduleKind: 'personal',
      fields: validRawFields('personal', { fullName: '张三', gender: 'male', city: '上海' }),
    })
    const library = newInfoLibrary({ entries: [original] })

    const result = await updateInfoEntry(library.deps, {
      entryId: original.id,
      fields: { fullName: '李四', email: 'li@example.com' },
    })

    expect(result.entry.id).toBe(original.id)
    expect(result.entry.sortOrder).toBe(original.sortOrder)
    expect(result.entry.origin).toBe(original.origin)
    expect(result.entry.createdAt).toBe(original.createdAt)
    expect(result.entry.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.entry.title).toBe('李四')
    // The whole record is replaced: an omitted optional field becomes null.
    expect(result.entry.fields.gender).toBeNull()
    expect(result.entry.fields.city).toBeNull()
    expect(result.entry.fields.email).toBe('li@example.com')
    await expect(library.entries.findById(original.id)).resolves.toEqual(result.entry)

    expect(result.change.op).toBe('infoEntry.update')
    expect(payload(result.change)).toEqual(original)
    expect(JSON.parse(result.change.afterJson ?? 'null')).toEqual(result.entry)
    expect(result.change.label).toBe('更新个人信息：李四')
  })

  it('reports a missing entry', async () => {
    const library = newInfoLibrary()
    await expectDomainErrorAsync(
      updateInfoEntry(library.deps, {
        entryId: asInfoEntryId('missing'),
        fields: { fullName: '李四' },
      }),
      'entryNotFound',
    )
  })

  it('reports a field record the module refuses', async () => {
    const original = infoEntryFixture({
      id: 'entry-1',
      moduleKind: 'personal',
      fields: validRawFields('personal'),
    })
    const library = newInfoLibrary({ entries: [original] })
    await expectDomainErrorAsync(
      updateInfoEntry(library.deps, {
        entryId: original.id,
        fields: { fullName: '' },
      }),
      'blankRequiredField',
    )
  })

  it('keeps the entry origin and records the origin of the edit', async () => {
    const original = infoEntryFixture({
      id: 'entry-1',
      moduleKind: 'personal',
      fields: validRawFields('personal'),
      origin: 'user',
    })
    const library = newInfoLibrary({ entries: [original] })

    const result = await updateInfoEntry(library.deps, {
      entryId: original.id,
      fields: { fullName: '张三丰' },
      origin: 'agent',
      sourceRunId: asAgentRunId('run-9'),
    })

    expect(result.entry.origin).toBe('user')
    expect(result.entry.sourceRunId).toBeNull()
    expect(result.change.origin).toBe('agent')
    expect(result.change.runId).toBe('run-9')
  })

  it('updates a custom entry against its definition', async () => {
    const custom = customModuleFixture()
    const original = infoEntryFixture({
      id: 'entry-1',
      moduleKind: 'custom',
      customModule: custom,
      fields: { title: 'CET-6', f_11111111: '大学英语六级' },
    })
    const library = newInfoLibrary({ entries: [original], customModules: [custom] })

    const result = await updateInfoEntry(library.deps, {
      entryId: original.id,
      fields: { title: 'CET-6', f_11111111: '大学英语六级', f_22222222: '560 分' },
    })
    expect(result.entry.fields.f_22222222).toBe('560 分')
  })
})

describe('deleteInfoEntry', () => {
  it('refuses an unconfirmed delete of a referenced entry and names the resumes', async () => {
    const entry = projectEntry('entry-1', 1)
    const references = referencesFor({
      'entry-1': [{ resumeId: RESUME_ID, resumeTitle: '后端简历', sectionId: SECTION_ID }],
    })
    const library = newInfoLibrary({ entries: [entry], entryReferences: references.byEntry })

    const error = await expectDomainErrorAsync(
      deleteInfoEntry(library.deps, { entryId: entry.id, confirmReferenced: false }),
      'entryReferenced',
    )

    expect(error.detail?.blockers).toEqual(['resume-1'])
    await expect(library.entries.findById(entry.id)).resolves.not.toBeNull()
    expect(library.changes.all()).toHaveLength(0)
  })

  it('deletes a confirmed referenced entry and records the whole row as before state', async () => {
    const entry = projectEntry('entry-1', 1)
    const references = referencesFor({
      'entry-1': [{ resumeId: RESUME_ID, resumeTitle: '后端简历', sectionId: SECTION_ID }],
    })
    const library = newInfoLibrary({ entries: [entry], entryReferences: references.byEntry })

    const result = await deleteInfoEntry(library.deps, {
      entryId: entry.id,
      confirmReferenced: true,
    })

    expect(result.referencedBy).toEqual([
      { resumeId: 'resume-1', resumeTitle: '后端简历', sectionId: 'section-1' },
    ])
    await expect(library.entries.findById(entry.id)).resolves.toBeNull()
    expect(result.change.op).toBe('infoEntry.delete')
    expect(payload(result.change)).toEqual(entry)
    expect(result.change.afterJson).toBeNull()
    expect(result.change.label).toBe('删除项目经历：订单中台')
  })

  it('deletes an unreferenced entry without confirmation', async () => {
    const entry = projectEntry('entry-1', 1)
    const library = newInfoLibrary({ entries: [entry] })

    const result = await deleteInfoEntry(library.deps, {
      entryId: entry.id,
      confirmReferenced: false,
    })

    expect(result.referencedBy).toEqual([])
    await expect(library.entries.findById(entry.id)).resolves.toBeNull()
  })

  it('reports a missing entry', async () => {
    const library = newInfoLibrary()
    await expectDomainErrorAsync(
      deleteInfoEntry(library.deps, { entryId: asInfoEntryId('missing'), confirmReferenced: true }),
      'entryNotFound',
    )
  })
})

describe('reorderInfoEntries', () => {
  it('rewrites the order densely and records both mappings', async () => {
    const first = projectEntry('entry-1', 1, '一')
    const second = projectEntry('entry-2', 2, '二')
    const third = projectEntry('entry-3', 3, '三')
    const library = newInfoLibrary({ entries: [first, second, third] })

    const result = await reorderInfoEntries(library.deps, {
      moduleKind: 'project',
      orderedEntryIds: [third.id, first.id, second.id],
    })

    expect(result.entries.map((entry) => entry.id)).toEqual(['entry-3', 'entry-1', 'entry-2'])
    expect(result.entries.map((entry) => entry.sortOrder)).toEqual([1, 2, 3])
    const stored = await library.entries.listByModule('project', null)
    expect(stored.map((entry) => entry.id)).toEqual(['entry-3', 'entry-1', 'entry-2'])
    expect(stored.map((entry) => entry.sortOrder)).toEqual([1, 2, 3])

    expect(result.change.op).toBe('infoEntry.reorder')
    expect(result.change.label).toBe('调整项目经历顺序')
    expect(payload(result.change)).toEqual([
      { id: 'entry-1', sortOrder: 1 },
      { id: 'entry-2', sortOrder: 2 },
      { id: 'entry-3', sortOrder: 3 },
    ])
    expect(JSON.parse(result.change.afterJson ?? 'null')).toEqual([
      { id: 'entry-3', sortOrder: 1 },
      { id: 'entry-1', sortOrder: 2 },
      { id: 'entry-2', sortOrder: 3 },
    ])
  })

  it('refuses a sequence that is not exactly the module entries', async () => {
    const first = projectEntry('entry-1', 1)
    const second = projectEntry('entry-2', 2)
    const library = newInfoLibrary({ entries: [first, second] })

    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'project',
        orderedEntryIds: [second.id],
      }),
      'entryNotFound',
    )
    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'project',
        orderedEntryIds: [second.id, asInfoEntryId('missing')],
      }),
      'entryNotFound',
    )
    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'project',
        orderedEntryIds: [second.id, second.id],
      }),
      'entryNotFound',
    )
  })

  it('accepts an empty module', async () => {
    const library = newInfoLibrary()
    const result = await reorderInfoEntries(library.deps, {
      moduleKind: 'award',
      orderedEntryIds: [],
    })
    expect(result.entries).toEqual([])
    expect(result.change.afterJson).toBe('[]')
  })

  it('requires the custom module of a custom reorder', async () => {
    const custom = customModuleFixture()
    const library = newInfoLibrary({ customModules: [custom] })

    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'custom',
        customModuleId: null,
        orderedEntryIds: [],
      }),
      'moduleKindMismatch',
    )
    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'custom',
        customModuleId: asCustomModuleId('missing'),
        orderedEntryIds: [],
      }),
      'customModuleNotFound',
    )
    await expectDomainErrorAsync(
      reorderInfoEntries(library.deps, {
        moduleKind: 'project',
        customModuleId: custom.id,
        orderedEntryIds: [],
      }),
      'moduleKindMismatch',
    )
  })
})

describe('listInfoEntries', () => {
  function populatedLibrary(): TestInfoLibrary {
    const custom: CustomModuleDefinition = customModuleFixture()
    return newInfoLibrary({
      customModules: [custom],
      entries: [
        infoEntryFixture({
          id: 'personal-1',
          moduleKind: 'personal',
          fields: validRawFields('personal'),
          sortOrder: 1,
        }),
        infoEntryFixture({
          id: 'project-2',
          moduleKind: 'project',
          fields: validRawFields('project', { name: '二' }),
          sortOrder: 2,
        }),
        infoEntryFixture({
          id: 'project-1',
          moduleKind: 'project',
          fields: validRawFields('project', { name: '一' }),
          sortOrder: 1,
        }),
        infoEntryFixture({
          id: 'education-1',
          moduleKind: 'education',
          fields: validRawFields('education'),
          sortOrder: 1,
        }),
        infoEntryFixture({
          id: 'custom-1',
          moduleKind: 'custom',
          customModule: custom,
          fields: { title: 'CET-6', f_11111111: '大学英语六级' },
          sortOrder: 1,
        }),
        infoEntryFixture({
          id: 'custom-2',
          moduleKind: 'custom',
          customModule: custom,
          fields: { title: 'AWS', f_11111111: 'AWS 认证' },
          sortOrder: 2,
        }),
      ],
    })
  }

  it('returns every entry in the canonical module order', async () => {
    const library = populatedLibrary()
    const result = await listInfoEntries(library.deps)
    expect(result.entries.map((entry) => entry.id)).toEqual([
      'personal-1',
      'education-1',
      'project-1',
      'project-2',
      'custom-1',
      'custom-2',
    ])
  })

  it('summarises every built-in module plus each custom module', async () => {
    const library = populatedLibrary()
    const result = await listInfoEntries(library.deps)
    expect(result.summaries).toHaveLength(9)
    expect(result.summaries[0]).toMatchObject({
      moduleKind: 'personal',
      customModuleId: null,
      label: '个人信息',
      entryCount: 1,
    })
    const project = result.summaries.find((summary) => summary.moduleKind === 'project')
    expect(project?.entryCount).toBe(2)
    const cert = result.summaries.at(-1)
    expect(cert).toMatchObject({
      moduleKind: 'custom',
      customModuleId: 'module-certificates',
      label: '证书',
      entryCount: 2,
    })
    const empty = result.summaries.find((summary) => summary.moduleKind === 'award')
    expect(empty?.entryCount).toBe(0)
    expect(result.customModules.map((module) => module.id)).toEqual(['module-certificates'])
  })

  it('filters by module kind and by custom module', async () => {
    const library = populatedLibrary()
    const projects = await listInfoEntries(library.deps, { moduleKind: 'project' })
    expect(projects.entries.map((entry) => entry.id)).toEqual(['project-1', 'project-2'])
    // The summaries stay library-wide so the navigation keeps its counts.
    expect(projects.summaries).toHaveLength(9)

    const certificates = await listInfoEntries(library.deps, {
      moduleKind: 'custom',
      customModuleId: asCustomModuleId('module-certificates'),
    })
    expect(certificates.entries.map((entry) => entry.id)).toEqual(['custom-1', 'custom-2'])
  })

  it('returns an empty library with the nine module summaries', async () => {
    const library = newInfoLibrary()
    const result = await listInfoEntries(library.deps)
    expect(result.entries).toEqual([])
    expect(result.summaries).toHaveLength(8)
    expect(result.customModules).toEqual([])
  })
})

describe('fixture time', () => {
  it('keeps the fixture timestamp stable', () => {
    expect(FIXTURE_TIME).toBe(parseDateTime('2026-01-01T00:00:00.000Z'))
  })
})
