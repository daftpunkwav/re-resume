/**
 * @file draftAndCanvasTools.test
 * @description The two draft tools and the two canvas tools: tailored text that
 * becomes an override, and free-positioned blocks validated against the page.
 */

import { describe, expect, it } from 'vitest'

import { readToolOutcomeMetadata } from '../../../../src/application/generation/toolOutcome'
import { anAttachment } from '../../../support/resumeFixtures'
import { createToolBed, createToolConversation, invokeTool, toolContextOf } from '../../../support/toolBed'

async function harness() {
  const bed = createToolBed()
  const conversation = await createToolConversation(bed)
  const context = toolContextOf(bed, conversation)
  return { bed, conversation, context }
}

describe('draft tools', () => {
  it('writes the summary override and reports the revision', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'writeResumeSummary',
      { resumeId: 'preview-resume-classic', text: '三年后端经验，专注订单链路优化。' },
      context,
    )
    const value = result.value as {
      resumeId: string
      overrideId: string
      revisionId: string
    }
    expect(readToolOutcomeMetadata(value)).toMatchObject({
      resumeId: 'preview-resume-classic',
      revisionId: value.revisionId,
    })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    const summary = resume?.document.overrides.find((override) => override.target.kind === 'summary')
    expect(summary).toMatchObject({ text: '三年后端经验，专注订单链路优化。', origin: 'agent' })
    expect((await bed.resumes.readRevision(value.revisionId as never))?.origin).toBe('agent')
  })

  it('keeps one override per target when rewritten', async () => {
    const { bed, context } = await harness()
    const first = await invokeTool(
      bed,
      'writeResumeSummary',
      { resumeId: 'preview-resume-classic', text: '第一版总结。' },
      context,
    )
    const second = await invokeTool(
      bed,
      'writeResumeSummary',
      { resumeId: 'preview-resume-classic', text: '第二版总结。' },
      context,
    )
    const firstValue = first.value as { overrideId: string }
    const secondValue = second.value as { overrideId: string }
    expect(secondValue.overrideId).toBe(firstValue.overrideId)
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    const summaries = resume?.document.overrides.filter(
      (override) => override.target.kind === 'summary',
    )
    expect(summaries).toHaveLength(1)
    expect(summaries?.[0]?.text).toBe('第二版总结。')
  })

  it('writes an entry override', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'writeEntryOverride',
      { resumeId: 'preview-resume-classic', entryId: 'preview-project-1', text: '改写后的项目描述。' },
      context,
    )
    expect(result.value).toMatchObject({ overrideId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.overrides).toContainEqual(
      expect.objectContaining({
        target: { kind: 'entry', entryId: 'preview-project-1' },
        text: '改写后的项目描述。',
      }),
    )
  })

  it('refuses text beyond the domain bound at parse time', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'writeResumeSummary',
      { resumeId: 'preview-resume-classic', text: '你'.repeat(4001) },
      context,
    )
    expect(result.ok).toBe(false)
    expect(result.parseError).toContain('text')
  })
})

describe('canvas tools', () => {
  it('adds a text block and reports the revision', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'addCanvasBlock',
      {
        resumeId: 'preview-resume-classic',
        kind: 'text',
        pageIndex: 0,
        box: { x: 40, y: 40, width: 220, height: 60 },
        text: '专注后端工程化',
      },
      context,
    )
    const value = result.value as { resumeId: string; blockId: string; revisionId: string }
    expect(readToolOutcomeMetadata(value)).toMatchObject({ resumeId: 'preview-resume-classic' })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.canvas.freeBlocks).toContainEqual(
      expect.objectContaining({ id: value.blockId, kind: 'text', text: '专注后端工程化' }),
    )
  })

  it('refuses a block outside the page as a readable result', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'addCanvasBlock',
      {
        resumeId: 'preview-resume-classic',
        kind: 'text',
        pageIndex: 0,
        box: { x: 5000, y: 40, width: 220, height: 60 },
        text: '出界',
      },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('canvasBlockOutOfBounds'),
    })
  })

  it('refuses an image block without an attachment', async () => {
    const { bed, context } = await harness()
    const result = await invokeTool(
      bed,
      'addCanvasBlock',
      {
        resumeId: 'preview-resume-classic',
        kind: 'image',
        pageIndex: 0,
        box: { x: 40, y: 40, width: 120, height: 80 },
      },
      context,
    )
    expect(result.value).toMatchObject({
      ok: false,
      error: expect.stringContaining('invalidFieldValue'),
    })
  })

  it('moves an existing block', async () => {
    const { bed, context } = await harness()
    const added = await invokeTool(
      bed,
      'addCanvasBlock',
      {
        resumeId: 'preview-resume-classic',
        kind: 'divider',
        pageIndex: 0,
        box: { x: 40, y: 120, width: 240, height: 12 },
      },
      context,
    )
    const blockId = (added.value as { blockId: string }).blockId
    const moved = await invokeTool(
      bed,
      'moveCanvasBlock',
      { resumeId: 'preview-resume-classic', blockId, x: 80, y: 150 },
      context,
    )
    expect(moved.value).toMatchObject({ revisionId: expect.any(String) })
    const resume = await bed.resumes.findById('preview-resume-classic' as never)
    expect(resume?.document.canvas.freeBlocks.find((block) => block.id === blockId)).toMatchObject({
      x: 80,
      y: 150,
    })
  })

  it('adds an image block when the attachment exists', async () => {
    const { bed, context } = await harness()
    await bed.attachments.insert(anAttachment('canvas-image'))
    const result = await invokeTool(
      bed,
      'addCanvasBlock',
      {
        resumeId: 'preview-resume-classic',
        kind: 'image',
        pageIndex: 0,
        box: { x: 40, y: 40, width: 120, height: 80 },
        attachmentId: 'canvas-image',
      },
      context,
    )
    expect(result.value).toMatchObject({ blockId: expect.any(String) })
  })
})
