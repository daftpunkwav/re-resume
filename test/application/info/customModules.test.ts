/**
 * @file customModules.test
 * @description The custom module use cases: creation bounds and key allocation,
 * renaming, field additions, confirmed field removal with its cleared values,
 * confirmed deletion with its cascade, and dense reordering.
 */

import { describe, expect, it } from 'vitest'

import { createCustomModule } from '../../../src/application/info/createCustomModule'
import { deleteCustomModule } from '../../../src/application/info/deleteCustomModule'
import { reorderCustomModules } from '../../../src/application/info/reorderCustomModules'
import { updateCustomModule } from '../../../src/application/info/updateCustomModule'
import type { CustomModuleDefinition } from '../../../src/domain/info/CustomModule'
import {
  asAgentRunId,
  asCustomFieldKey,
  asCustomModuleId,
  asResumeId,
  asResumeSectionId,
} from '../../../src/domain/shared/branded-id'
import {
  customFieldsFixture,
  customModuleFixture,
  infoEntryFixture,
} from '../../support/infoFixtures'
import { newInfoLibrary, referencesFor } from '../../support/infoLibrary'
import { expectDomainErrorAsync } from '../../support/domainErrors'

const MODULE_ID = asCustomModuleId('module-certificates')

function moduleWithId(index: number): CustomModuleDefinition {
  return customModuleFixture({
    id: asCustomModuleId(`module-${index.toString()}`),
    name: `模块${index.toString()}`,
    sortOrder: index,
  })
}

function customEntry(
  id: string,
  module: CustomModuleDefinition,
  values: Record<string, string> = {},
) {
  return infoEntryFixture({
    id,
    moduleKind: 'custom',
    customModule: module,
    fields: { title: 'CET-6', f_11111111: '证书名称', ...values },
    sortOrder: 1,
  })
}

function payload(json: string | null): unknown {
  return json === null ? null : JSON.parse(json)
}

describe('createCustomModule', () => {
  it('allocates field keys in the fixed format and appends the definition', async () => {
    const library = newInfoLibrary()

    const result = await createCustomModule(library.deps, {
      name: '  证书  ',
      fields: [
        { label: '证书名称', type: 'text', required: true, maxLength: 120 },
        { label: '说明', type: 'textarea', required: false, maxLength: 600 },
      ],
    })

    expect(result.module.name).toBe('证书')
    expect(result.module.sortOrder).toBe(1)
    expect(result.module.fields).toHaveLength(2)
    for (const field of result.module.fields) {
      expect(field.key).toMatch(/^f_[0-9a-f]{8}$/u)
    }
    expect(result.module.fields[0]?.label).toBe('证书名称')
    expect(result.module.fields[1]?.type).toBe('textarea')
    await expect(library.customModules.findById(result.module.id)).resolves.toEqual(result.module)

    expect(result.change.op).toBe('customModule.create')
    expect(result.change.afterJson).not.toBeNull()
    expect(payload(result.change.afterJson)).toEqual(result.module)
    expect(result.change.beforeJson).toBeNull()
    expect(result.change.label).toBe('新增自定义模块：证书')
  })

  it('reports the module limit', async () => {
    const modules = Array.from({ length: 20 }, (_, index) => moduleWithId(index + 1))
    const library = newInfoLibrary({ customModules: modules })

    const error = await expectDomainErrorAsync(
      createCustomModule(library.deps, {
        name: '第二十一个模块',
        fields: [{ label: '名称', type: 'text', required: true, maxLength: 40 }],
      }),
      'customModuleLimit',
    )
    expect(error.code).toBe('customModuleLimit')
  })

  it('refuses a name another module already holds, ignoring case', async () => {
    const existing = customModuleFixture({ id: MODULE_ID, name: 'Certificates' })
    const library = newInfoLibrary({ customModules: [existing] })

    await expectDomainErrorAsync(
      createCustomModule(library.deps, {
        name: 'certificates',
        fields: [{ label: '名称', type: 'text', required: true, maxLength: 40 }],
      }),
      'invalidFieldValue',
    )
  })

  it('refuses an empty field list, more than twelve fields and invalid bounds', async () => {
    const library = newInfoLibrary()

    await expectDomainErrorAsync(
      createCustomModule(library.deps, { name: '证书', fields: [] }),
      'blankRequiredField',
    )

    const thirteen = Array.from({ length: 13 }, (_, index) => ({
      label: `字段${index.toString()}`,
      type: 'text' as const,
      required: false,
      maxLength: 20,
    }))
    await expectDomainErrorAsync(
      createCustomModule(library.deps, { name: '证书', fields: thirteen }),
      'customFieldLimit',
    )

    await expectDomainErrorAsync(
      createCustomModule(library.deps, {
        name: '证书',
        fields: [{ label: '名称', type: 'text', required: true, maxLength: 201 }],
      }),
      'fieldTooLong',
    )
    await expectDomainErrorAsync(
      createCustomModule(library.deps, {
        name: '证书',
        fields: [{ label: ' ', type: 'text', required: true, maxLength: 20 }],
      }),
      'blankRequiredField',
    )
  })

  it('records the agent run of an agent-created module', async () => {
    const library = newInfoLibrary()
    const result = await createCustomModule(library.deps, {
      name: '证书',
      fields: [{ label: '名称', type: 'text', required: true, maxLength: 40 }],
      origin: 'agent',
      sourceRunId: asAgentRunId('run-1'),
    })
    expect(result.change.origin).toBe('agent')
    expect(result.change.runId).toBe('run-1')
    await expectDomainErrorAsync(
      createCustomModule(library.deps, {
        name: '奖项',
        fields: [{ label: '名称', type: 'text', required: true, maxLength: 40 }],
        origin: 'agent',
      }),
      'invalidFieldValue',
    )
  })
})

describe('updateCustomModule', () => {
  it('renames the module and keeps the fields', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const library = newInfoLibrary({ customModules: [module] })

    const result = await updateCustomModule(library.deps, {
      moduleId: module.id,
      name: ' 职业证书 ',
    })

    expect(result.module.name).toBe('职业证书')
    expect(result.module.fields).toEqual(module.fields)
    expect(result.change.op).toBe('customModule.update')
    expect(result.change.label).toBe('更新自定义模块：职业证书')
    expect(payload(result.change.beforeJson)).toEqual({ module, clearedValues: [] })
    expect(payload(result.change.afterJson)).toEqual(result.module)
  })

  it('appends a newly keyed field and keeps the existing keys', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const library = newInfoLibrary({ customModules: [module] })

    const result = await updateCustomModule(library.deps, {
      moduleId: module.id,
      fields: [
        { ...customFieldsFixture()[0], key: asCustomFieldKey('f_11111111') },
        { ...customFieldsFixture()[1], key: asCustomFieldKey('f_22222222') },
        { label: '获得时间', type: 'text', required: false, maxLength: 40 },
      ],
    })

    expect(result.module.fields).toHaveLength(3)
    expect(result.module.fields[0]?.key).toBe('f_11111111')
    expect(result.module.fields[2]?.label).toBe('获得时间')
    expect(result.module.fields[2]?.key).toMatch(/^f_[0-9a-f]{8}$/u)
    expect(result.clearedEntryCount).toBe(0)
  })

  it('blocks a field removal that would lose stored values until it is confirmed', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const entry = customEntry('entry-1', module, {
      f_11111111: '大学英语六级',
      f_22222222: '560 分',
    })
    const library = newInfoLibrary({ customModules: [module], entries: [entry] })

    const removalInput = {
      moduleId: module.id,
      fields: [{ ...customFieldsFixture()[0], key: asCustomFieldKey('f_11111111') }],
    }
    const error = await expectDomainErrorAsync(
      updateCustomModule(library.deps, removalInput),
      'fieldRemovalBlocked',
    )
    expect(error.detail?.blockers).toEqual(['entry-1'])
    // Nothing changed before the refusal.
    expect((await library.customModules.findById(module.id))?.fields).toHaveLength(2)

    const result = await updateCustomModule(library.deps, {
      ...removalInput,
      confirmValuesLoss: true,
    })
    expect(result.module.fields).toHaveLength(1)
    expect(result.clearedEntryCount).toBe(1)
    const stored = await library.entries.findById(entry.id)
    expect(stored?.fields.f_11111111).toBe('大学英语六级')
    expect(stored?.fields).not.toHaveProperty('f_22222222')
    expect(payload(result.change.beforeJson)).toEqual({
      module,
      clearedValues: [{ entryId: 'entry-1', fieldKey: 'f_22222222', value: '560 分' }],
    })
  })

  it('removes a field that holds no values without confirmation', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const entry = customEntry('entry-1', module, { f_11111111: '大学英语六级' })
    const library = newInfoLibrary({ customModules: [module], entries: [entry] })

    const result = await updateCustomModule(library.deps, {
      moduleId: module.id,
      fields: [{ ...customFieldsFixture()[0], key: asCustomFieldKey('f_11111111') }],
    })
    expect(result.clearedEntryCount).toBe(0)
  })

  it('keeps the shape of an existing field and refuses a silent change', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const library = newInfoLibrary({ customModules: [module] })
    const textarea = customFieldsFixture()[1]

    await expectDomainErrorAsync(
      updateCustomModule(library.deps, {
        moduleId: module.id,
        fields: [
          { ...customFieldsFixture()[0], key: asCustomFieldKey('f_11111111') },
          { ...textarea, key: asCustomFieldKey('f_22222222'), maxLength: 300 },
        ],
      }),
      'invalidFieldValue',
    )
  })

  it('refuses an unknown or duplicated field key', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const library = newInfoLibrary({ customModules: [module] })
    const known = { ...customFieldsFixture()[0], key: asCustomFieldKey('f_11111111') }

    await expectDomainErrorAsync(
      updateCustomModule(library.deps, {
        moduleId: module.id,
        fields: [{ ...customFieldsFixture()[0], key: asCustomFieldKey('f_99999999') }],
      }),
      'unknownField',
    )
    await expectDomainErrorAsync(
      updateCustomModule(library.deps, {
        moduleId: module.id,
        fields: [known, known],
      }),
      'duplicateFieldKey',
    )
  })

  it('refuses a duplicate name and a missing module', async () => {
    const first = customModuleFixture({ id: asCustomModuleId('module-a'), name: '证书', sortOrder: 1 })
    const second = customModuleFixture({ id: asCustomModuleId('module-b'), name: '奖项', sortOrder: 2 })
    const library = newInfoLibrary({ customModules: [first, second] })

    await expectDomainErrorAsync(
      updateCustomModule(library.deps, { moduleId: second.id, name: '证书' }),
      'invalidFieldValue',
    )
    await expectDomainErrorAsync(
      updateCustomModule(library.deps, { moduleId: asCustomModuleId('missing'), name: 'x' }),
      'customModuleNotFound',
    )
  })
})

describe('deleteCustomModule', () => {
  const RESUME_ID = asResumeId('resume-1')
  const SECTION_ID = asResumeSectionId('section-1')

  it('reports the cascade and the referencing sections before confirmation', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const entries = [customEntry('entry-1', module), customEntry('entry-2', module)]
    const references = referencesFor(
      {},
      {
        'module-certificates': [
          { resumeId: RESUME_ID, resumeTitle: '后端简历', sectionId: SECTION_ID },
        ],
      },
    )
    const library = newInfoLibrary({
      customModules: [module],
      entries,
      moduleReferences: references.byModule,
    })

    const error = await expectDomainErrorAsync(
      deleteCustomModule(library.deps, { moduleId: module.id, confirmEntries: false }),
      'entryReferenced',
    )
    expect(error.detail?.blockers).toEqual(['entries:2', 'sections:1', 'resume-1'])
    await expect(library.customModules.findById(module.id)).resolves.not.toBeNull()
    await expect(library.entries.listByModule('custom', module.id)).resolves.toHaveLength(2)
  })

  it('deletes the entries and the definition and records both', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const entries = [customEntry('entry-1', module), customEntry('entry-2', module)]
    const library = newInfoLibrary({ customModules: [module], entries })

    const result = await deleteCustomModule(library.deps, {
      moduleId: module.id,
      confirmEntries: true,
    })

    expect(result.entryCount).toBe(2)
    expect(result.referencedBy).toEqual([])
    await expect(library.customModules.findById(module.id)).resolves.toBeNull()
    await expect(library.entries.listByModule('custom', module.id)).resolves.toEqual([])
    expect(result.change.op).toBe('customModule.delete')
    expect(payload(result.change.beforeJson)).toEqual({ module, entries })
    expect(result.change.afterJson).toBeNull()
    expect(result.change.label).toBe('删除自定义模块：证书')
  })

  it('deletes a module with no entries without confirmation', async () => {
    const module = customModuleFixture({ id: MODULE_ID })
    const library = newInfoLibrary({ customModules: [module] })

    const result = await deleteCustomModule(library.deps, {
      moduleId: module.id,
      confirmEntries: false,
    })
    expect(result.entryCount).toBe(0)
    await expect(library.customModules.findById(module.id)).resolves.toBeNull()
  })

  it('reports a missing module', async () => {
    const library = newInfoLibrary()
    await expectDomainErrorAsync(
      deleteCustomModule(library.deps, { moduleId: MODULE_ID, confirmEntries: true }),
      'customModuleNotFound',
    )
  })
})

describe('reorderCustomModules', () => {
  it('rewrites the order densely and records both mappings', async () => {
    const first = customModuleFixture({ id: asCustomModuleId('module-a'), name: 'A', sortOrder: 1 })
    const second = customModuleFixture({ id: asCustomModuleId('module-b'), name: 'B', sortOrder: 2 })
    const library = newInfoLibrary({ customModules: [first, second] })

    const result = await reorderCustomModules(library.deps, {
      orderedModuleIds: [second.id, first.id],
    })

    expect(result.modules.map((module) => module.id)).toEqual(['module-b', 'module-a'])
    expect(result.modules.map((module) => module.sortOrder)).toEqual([1, 2])
    const stored = await library.customModules.listAll()
    expect(stored.map((module) => module.id)).toEqual(['module-b', 'module-a'])
    expect(result.change.op).toBe('customModule.reorder')
    expect(result.change.entityId).toBe('customModules')
    expect(result.change.label).toBe('调整自定义模块顺序')
    expect(payload(result.change.beforeJson)).toEqual([
      { id: 'module-a', sortOrder: 1 },
      { id: 'module-b', sortOrder: 2 },
    ])
    expect(payload(result.change.afterJson)).toEqual([
      { id: 'module-b', sortOrder: 1 },
      { id: 'module-a', sortOrder: 2 },
    ])
  })

  it('refuses a sequence that is not exactly the current modules', async () => {
    const first = customModuleFixture({ id: asCustomModuleId('module-a'), name: 'A', sortOrder: 1 })
    const second = customModuleFixture({ id: asCustomModuleId('module-b'), name: 'B', sortOrder: 2 })
    const library = newInfoLibrary({ customModules: [first, second] })

    await expectDomainErrorAsync(
      reorderCustomModules(library.deps, { orderedModuleIds: [second.id] }),
      'customModuleNotFound',
    )
    await expectDomainErrorAsync(
      reorderCustomModules(library.deps, {
        orderedModuleIds: [second.id, asCustomModuleId('missing')],
      }),
      'customModuleNotFound',
    )
    await expectDomainErrorAsync(
      reorderCustomModules(library.deps, { orderedModuleIds: [second.id, second.id] }),
      'customModuleNotFound',
    )
  })
})
