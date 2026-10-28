/**
 * @file undoTools.test
 * @description Taking back an agent write: a library change by its record, a
 * resume revision by moving the cursor — and the refusals that keep undo from
 * lying about the document (a later write, a user revision, a user change).
 */

import { describe, expect, it } from 'vitest'

import {
  undoAgentChange,
  undoRevision,
} from '../../../../src/application/generation/tools/undoTools'
import type { ChangeRecord } from '../../../../src/domain/changes/ChangeRecord'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import {
  asChangeRecordId,
  asResumeId,
  asRevisionId,
} from '../../../../src/domain/shared/branded-id'
import { createToolBed, createToolConversation, invokeTool, toolContextOf } from '../../../support/toolBed'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

async function harness() {
  const bed = createToolBed()
  const conversation = await createToolConversation(bed)
  const context = toolContextOf(bed, conversation)
  return { bed, conversation, context }
}

async function writeRevision(
  bed: ReturnType<typeof createToolBed>,
  context: ReturnType<typeof toolContextOf>,
  text: string,
): Promise<string> {
  const result = await invokeTool(
    bed,
    'setSectionDisplay',
    { resumeId: 'preview-resume-classic', sectionId: 'preview-section-project', displayName: text },
    context,
  )
  return (result.value as { revisionId: string }).revisionId
}

describe('undoLastChange through the tool', () => {
  it('reverses the library change it names', async () => {
    const { bed, context } = await harness()
    const created = await invokeTool(
      bed,
      'createInfoEntry',
      { moduleKind: 'skill', fields: { name: 'Rust' } },
      context,
    )
    const createdValue = created.value as { entryId: string; changeId: string }
    const result = await invokeTool(
      bed,
      'undoLastChange',
      { target: 'library', changeId: createdValue.changeId },
      context,
    )
    expect(result.value).toMatchObject({ undone: true, label: expect.stringContaining('新增') })
    expect(await bed.entries.findById(createdValue.entryId as never)).toBeNull()
    const record = await bed.changes.findById(createdValue.changeId as never)
    expect(record?.undoneAt).not.toBeNull()
  })

  it('moves the resume cursor back over the latest agent revision', async () => {
    const { bed, context } = await harness()
    const before = await bed.resumes.findById('preview-resume-classic' as never)
    const revisionId = await writeRevision(bed, context, '项目成果')
    const result = await invokeTool(
      bed,
      'undoLastChange',
      { target: 'resume', resumeId: 'preview-resume-classic' },
      context,
    )
    expect(result.value).toMatchObject({ undone: true })
    const after = await bed.resumes.findById('preview-resume-classic' as never)
    expect(after?.currentRevision).toBe(before?.currentRevision)
    expect(after?.currentRevision).not.toBe(revisionId)
  })

  it('refuses a missing target identifier', async () => {
    const { bed, context } = await harness()
    const library = await invokeTool(bed, 'undoLastChange', { target: 'library' }, context)
    expect(library.value).toMatchObject({ ok: false, error: expect.stringContaining('blankRequiredField') })
    const resume = await invokeTool(bed, 'undoLastChange', { target: 'resume' }, context)
    expect(resume.value).toMatchObject({ ok: false, error: expect.stringContaining('blankRequiredField') })
  })
})

describe('the card-level revision undo', () => {
  it('reverses the current revision and refuses an older one', async () => {
    const { bed, context } = await harness()
    const first = await writeRevision(bed, context, '第一次改名')
    const second = await writeRevision(bed, context, '第二次改名')

    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('preview-resume-classic'),
        revisionId: asRevisionId(first),
      }),
    ).rejects.toMatchObject({ code: 'changeOutOfOrder' })

    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('preview-resume-classic'),
        revisionId: asRevisionId(second),
      }),
    ).resolves.toMatchObject({ label: '重命名章节' })

    // With the newer revision undone, the older one is the cursor again.
    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('preview-resume-classic'),
        revisionId: asRevisionId(first),
      }),
    ).resolves.toBeDefined()
  })

  it('refuses a revision the user wrote', async () => {
    const { bed } = await harness()
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('preview-resume-classic'),
        revisionId: asRevisionId(resume?.currentRevision as string),
      }),
    ).rejects.toMatchObject({ code: 'changeOutOfOrder' })
  })

  it('refuses an unknown resume and an unknown revision', async () => {
    const { bed } = await harness()
    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('missing'),
        revisionId: asRevisionId('revision'),
      }),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    await expect(
      undoRevision({ resumes: bed.resumes }, {
        resumeId: asResumeId('preview-resume-classic'),
        revisionId: asRevisionId(resume?.currentRevision as string),
      }),
    ).rejects.toMatchObject({ code: 'changeOutOfOrder' })
  })
})

describe('undoAgentChange', () => {
  it('refuses a user-recorded library change', async () => {
    const { bed } = await harness()
    const record: ChangeRecord = {
      id: asChangeRecordId('user-change'),
      scope: 'library',
      entity: 'infoEntry',
      entityId: 'preview-skill-1',
      op: 'infoEntry.update',
      beforeJson: null,
      afterJson: null,
      origin: 'user',
      runId: null,
      conversationId: null,
      label: 'user edit',
      undoneAt: null,
      createdAt: AT,
    }
    await bed.changes.append(record)
    await expect(
      undoAgentChange(
        {
          changes: bed.changes,
          entries: bed.entries,
          customModules: bed.customModules,
          resumes: bed.resumes,
          clock: bed.clock,
        },
        { changeIds: [record.id] },
      ),
    ).rejects.toMatchObject({ code: 'changeOutOfOrder' })
  })

  it('rejects an empty target', async () => {
    const { bed } = await harness()
    await expect(
      undoAgentChange(
        {
          changes: bed.changes,
          entries: bed.entries,
          customModules: bed.customModules,
          resumes: bed.resumes,
          clock: bed.clock,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'blankRequiredField' })
  })

  it('reverses library changes newest first', async () => {
    const { bed, context } = await harness()
    const first = await invokeTool(
      bed,
      'createInfoEntry',
      { moduleKind: 'skill', fields: { name: 'Rust' } },
      context,
    )
    const second = await invokeTool(
      bed,
      'createInfoEntry',
      { moduleKind: 'skill', fields: { name: 'Go' } },
      context,
    )
    const changeIds = [
      (first.value as { changeId: string }).changeId as never,
      (second.value as { changeId: string }).changeId as never,
    ]
    const result = await undoAgentChange(
      {
        changes: bed.changes,
        entries: bed.entries,
        customModules: bed.customModules,
        resumes: bed.resumes,
        clock: bed.clock,
      },
      { changeIds },
    )
    expect(result.undone).toHaveLength(2)
    expect((await bed.changes.findById(changeIds[0] as never))?.undoneAt).not.toBeNull()
    expect((await bed.changes.findById(changeIds[1] as never))?.undoneAt).not.toBeNull()
  })
})
