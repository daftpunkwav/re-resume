/**
 * @file infoTools.test
 * @description The library-writing tools: creating and updating entries, the
 * custom module definition, and the posting analysis on its text and image
 * paths. Every write reports the change record the card can undo, and every
 * refusal comes back as model-readable text instead of failing the run.
 */

import { describe, expect, it } from 'vitest'

import { anAttachment } from '../../../support/resumeFixtures'
import { createToolBed, createToolConversation, invokeTool, toolContextOf } from '../../../support/toolBed'

const PARSED_POSTING = {
  title: '后端开发工程师',
  company: null,
  responsibilities: ['负责订单链路开发'],
  requirements: ['熟悉 TypeScript'],
  keywords: ['TypeScript'],
}

async function harness() {
  const bed = createToolBed()
  const conversation = await createToolConversation(bed)
  const context = toolContextOf(bed, conversation)
  return { bed, conversation, context }
}

function parsedAnswer(): { chunks: { type: 'text'; textDelta: string }[] } {
  return { chunks: [{ type: 'text', textDelta: JSON.stringify(PARSED_POSTING) }] }
}

describe('createInfoEntry and updateInfoEntry', () => {
  it('creates an agent-attributed entry and reports its change record', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'createInfoEntry',
      { moduleKind: 'skill', fields: { name: 'Rust' } },
      context,
    )
    const value = result.value as { entryId: string; title: string; changeId: string }
    expect(value.title).toBe('Rust')
    const entry = await bed.entries.findById(value.entryId as never)
    expect(entry).toMatchObject({ origin: 'agent', sourceRunId: 'run-tool-test', title: 'Rust' })
    const record = await bed.changes.findById(value.changeId as never)
    expect(record).toMatchObject({
      op: 'infoEntry.create',
      origin: 'agent',
      conversationId: context.conversationId,
      undoneAt: null,
    })
  })

  it('maps a field validation refusal to a model-readable error', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'createInfoEntry',
      { moduleKind: 'skill', fields: {} },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('blankRequiredField'),
    })
  })

  it('replaces the whole field record and records the before state', async () => {
    const { bed, context } = await harness()
    const updated = await invokeTool(
      bed,
      'updateInfoEntry',
      { entryId: 'preview-skill-1', fields: { name: 'TypeScript', category: '语言' } },
      context,
    )
    const value = updated.value as { entryId: string; changeId: string }
    expect(value.entryId).toBe('preview-skill-1')
    const record = await bed.changes.findById(value.changeId as never)
    expect(record).toMatchObject({ op: 'infoEntry.update', origin: 'agent' })
    expect(record?.beforeJson).not.toBeNull()
    const entry = await bed.entries.findById('preview-skill-1' as never)
    expect(entry?.fields['name']).toBe('TypeScript')
  })
})

describe('createCustomModule', () => {
  it('creates the definition and reports its change record', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'createCustomModule',
      { name: '职业技能证书', fields: [{ label: '名称', type: 'text', required: true, maxLength: 60 }] },
      context,
    )
    const value = result.value as { moduleId: string; changeId: string }
    const module = await bed.customModules.findById(value.moduleId as never)
    expect(module?.name).toBe('职业技能证书')
    expect(module?.fields).toHaveLength(1)
    const record = await bed.changes.findById(value.changeId as never)
    expect(record).toMatchObject({ op: 'customModule.create', origin: 'agent' })
  })
})

describe('analyzeJobDescription', () => {
  it('stores the posted text, parses it and records the parse run', async () => {
    const { bed, context } = await harness()
    bed.model.enqueue(parsedAnswer())
    const rawText = '负责订单链路开发。要求熟悉 TypeScript。'
    const result = await invokeTool(
      bed,
      'analyzeJobDescription',
      { text: rawText },
      context,
    )
    const value = result.value as { jobPostingId: string; parsed: { title: string } }
    expect(value.parsed.title).toBe('后端开发工程师')
    const posting = await bed.jobPostings.findById(value.jobPostingId as never)
    expect(posting).toMatchObject({
      rawText,
      source: 'paste',
      conversationId: context.conversationId,
    })
    expect(posting?.parsedByRunId).not.toBeNull()
  })

  it('transcribes an image posting when the model takes image parts', async () => {
    const { bed, context } = await harness()
    bed.model.supportsImages = true
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '负责订单链路开发。要求熟悉 TypeScript。' }] })
    bed.model.enqueue(parsedAnswer())
    await bed.attachments.insert(anAttachment('job-image'))
    await bed.fileStore.write('job-image.png', new Uint8Array([1, 2, 3]))
    const result = await invokeTool(
      bed,
      'analyzeJobDescription',
      { attachmentId: 'job-image' },
      context,
    )
    const value = result.value as { jobPostingId: string }
    const posting = await bed.jobPostings.findById(value.jobPostingId as never)
    expect(posting).toMatchObject({
      rawText: '负责订单链路开发。要求熟悉 TypeScript。',
      source: 'image',
      imageAttachmentIds: ['job-image'],
    })
  })

  it('refuses an image when the model has no image input', async () => {
    const { bed, context } = await harness()
    await bed.attachments.insert(anAttachment('job-image'))
    const result = await invokeTool(
      bed,
      'analyzeJobDescription',
      { attachmentId: 'job-image' },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('unsupportedImageType'),
    })
  })

  it('refuses a non-image attachment readably', async () => {
    const { bed, context } = await harness()
    await bed.attachments.insert({
      ...anAttachment('job-pdf'),
      kind: 'file',
      mimeType: 'application/pdf',
      storageName: 'job-pdf.pdf',
    })
    const result = await invokeTool(
      bed,
      'analyzeJobDescription',
      { attachmentId: 'job-pdf' },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalidFieldValue'),
    })
  })

  it('asks for text or an attachment when both are missing', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(bed, 'analyzeJobDescription', {}, context)
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('blankRequiredField'),
    })
    expect(bed.model.calls).toBe(0)
  })
})
