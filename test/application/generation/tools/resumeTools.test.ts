/**
 * @file resumeTools.test
 * @description The resume-writing tools: creation with an initial selection,
 * metadata edits, and the document changes that each commit one agent revision.
 * Every document write reports the resume and revision the card can undo.
 */

import { describe, expect, it } from 'vitest'

import { readToolOutcomeMetadata } from '../../../../src/application/generation/toolOutcome'
import { createToolBed, createToolConversation, invokeTool, toolContextOf } from '../../../support/toolBed'

async function harness() {
  const bed = createToolBed()
  const conversation = await createToolConversation(bed)
  const context = toolContextOf(bed, conversation)
  return { bed, conversation, context }
}

const SECOND_COLUMN_TEMPLATE = 'two-column-sidebar'

describe('createResume and updateResume', () => {
  it('creates a resume with an initial selection and an agent revision', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'createResume',
      {
        title: '后端开发工程师简历',
        targetJob: { title: '后端开发工程师', company: '目标公司' },
        templateId: 'classic-single',
        selection: [
          { moduleKind: 'personal', entryIds: ['preview-personal-1'] },
          { moduleKind: 'project', entryIds: ['preview-project-1', 'preview-project-2'] },
          { moduleKind: 'skill', entryIds: ['preview-skill-1'] },
        ],
      },
      context,
    )
    const value = result.value as { resumeId: string; revisionId: string }
    expect(readToolOutcomeMetadata(value)).toMatchObject({
      resumeId: value.resumeId,
      revisionId: value.revisionId,
    })
    const resume = await bed.resumes.findById(value.resumeId as never)
    expect(resume).toMatchObject({
      title: '后端开发工程师简历',
      status: 'draft',
      conversationId: context.conversationId,
      targetJob: { title: '后端开发工程师', company: '目标公司' },
    })
    const project = resume?.document.sections.find((section) => section.moduleKind === 'project')
    expect(project?.entryIds).toEqual(['preview-project-1', 'preview-project-2'])
    const revision = await bed.resumes.readRevision(value.revisionId as never)
    expect(revision).toMatchObject({ origin: 'agent', runId: context.runId, seq: 1 })
  })

  it('updates metadata without producing a revision', async () => {
    const { bed, context } = await harness()
    const before = await bed.resumes.findById('preview-resume-classic' as never)
    const renamed = await invokeTool(
      bed,
      'updateResume',
      {
        resumeId: 'preview-resume-classic',
        title: '定制标题',
        targetJob: { title: '产品经理', company: null },
      },
      context,
    )
    expect(renamed.value).toMatchObject({ resumeId: 'preview-resume-classic', reversible: false })
    const after = await bed.resumes.findById('preview-resume-classic' as never)
    expect(after?.title).toBe('定制标题')
    expect(after?.targetJob?.title).toBe('产品经理')
    expect(after?.currentRevision).toBe(before?.currentRevision)
  })

  it('refuses an update without any field', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'updateResume',
      { resumeId: 'preview-resume-classic' },
      context,
    )
    expect(result.value).toMatchObject({ ok: false, error: expect.stringContaining('blankRequiredField') })
  })
})

describe('the document tools', () => {
  it('selects entries for a chapter and records an agent revision', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setSectionSelection',
      {
        resumeId: 'preview-resume-classic',
        moduleKind: 'project',
        entryIds: ['preview-project-2'],
      },
      context,
    )
    const value = result.value as { resumeId: string; sectionId: string; revisionId: string }
    expect(readToolOutcomeMetadata(value)).toMatchObject({ resumeId: 'preview-resume-classic' })
    const revision = await bed.resumes.readRevision(value.revisionId as never)
    expect(revision).toMatchObject({ origin: 'agent', runId: context.runId })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    const project = resume?.document.sections.find((section) => section.id === value.sectionId)
    expect(project?.entryIds).toEqual(['preview-project-2'])
  })

  it('reorders chapters', async () => {
    const { bed, context } = await harness()
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    const ids = resume?.document.sections.map((section) => section.id) ?? []
    const result = await invokeTool(
      bed,
      'setSectionOrder',
      { resumeId: 'preview-resume-classic', orderedSectionIds: [...ids].reverse() },
      context,
    )
    const value = result.value as { revisionId: string }
    const updated = await bed.resumes.findById('preview-resume-classic' as never)
    expect(updated?.document.sections.map((section) => section.id)).toEqual([...ids].reverse())
    expect((await bed.resumes.readRevision(value.revisionId as never))?.origin).toBe('agent')
  })

  it('renames and hides a chapter', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setSectionDisplay',
      {
        resumeId: 'preview-resume-classic',
        sectionId: 'preview-section-project',
        displayName: '项目成果',
        visible: false,
      },
      context,
    )
    expect(result.value).toMatchObject({ revisionId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    const section = resume?.document.sections.find((entry) => entry.id === 'preview-section-project')
    expect(section).toMatchObject({ displayName: '项目成果', visible: false })
  })

  it('switches the template', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setTemplate',
      { resumeId: 'preview-resume-classic', templateId: SECOND_COLUMN_TEMPLATE },
      context,
    )
    expect(result.value).toMatchObject({ revisionId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.templateId).toBe(SECOND_COLUMN_TEMPLATE)
  })

  it('patches appearance and refuses an out-of-range value', async () => {
    const { bed, context } = await harness()
    const ok = await invokeTool(
      bed,
      'setAppearance',
      { resumeId: 'preview-resume-classic', accentColor: 'amber', lineHeight: 1.6 },
      context,
    )
    expect(ok.value).toMatchObject({ revisionId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.appearance).toMatchObject({ accentColor: 'amber', lineHeight: 1.6 })

    const refused = await invokeTool(
      bed,
      'setAppearance',
      { resumeId: 'preview-resume-classic', fontScale: 0.87 },
      context,
    )
    expect(refused.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalidSettings'),
    })
  })

  it('patches the page and refuses an out-of-range margin', async () => {
    const { bed, context } = await harness()
    const ok = await invokeTool(
      bed,
      'setPageSetup',
      { resumeId: 'preview-resume-classic', paper: 'Letter', marginTop: 60 },
      context,
    )
    expect(ok.value).toMatchObject({ revisionId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.pageSetup).toMatchObject({ paper: 'Letter', marginTop: 60 })

    const refused = await invokeTool(
      bed,
      'setPageSetup',
      { resumeId: 'preview-resume-classic', columns: 2 },
      context,
    )
    expect(refused.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalidPageSetup'),
    })
  })

  it('refuses an empty display patch instead of writing a no-op revision', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setSectionDisplay',
      { resumeId: 'preview-resume-classic', sectionId: 'preview-section-project' },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('blankRequiredField'),
    })
  })

  it('refuses an empty appearance or page patch', async () => {
    const { bed, context } = await harness()
    const appearance = await invokeTool(
      bed,
      'setAppearance',
      { resumeId: 'preview-resume-classic' },
      context,
    )
    expect(appearance.value).toMatchObject({ ok: false })
    const page = await invokeTool(
      bed,
      'setPageSetup',
      { resumeId: 'preview-resume-classic' },
      context,
    )
    expect(page.value).toMatchObject({ ok: false })
  })

  it('refuses an order that does not name the current sections', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setSectionOrder',
      { resumeId: 'preview-resume-classic', orderedSectionIds: ['preview-section-project'] },
      context,
    )
    expect(result.value).toMatchObject({ ok: false })
  })

  it('refuses an unknown resume at the use case, as a readable result', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'setSectionDisplay',
      { resumeId: 'missing', sectionId: 'preview-section-project', visible: true },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('resumeNotFound'),
    })
  })
})
