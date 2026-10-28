/**
 * @file appearanceCanvas.test
 * @description Template, appearance, page and canvas use cases: the defaults a
 * template switch applies, the validation refusals, and the free-block bounds
 * and page checks.
 */

import { describe, expect, it } from 'vitest'

import { addCanvasBlock } from '../../../src/application/resume/addCanvasBlock'
import { checkLayoutOverflow } from '../../../src/application/resume/checkLayoutOverflow'
import { moveCanvasBlock } from '../../../src/application/resume/moveCanvasBlock'
import { removeCanvasBlock } from '../../../src/application/resume/removeCanvasBlock'
import { resizeCanvasBlock } from '../../../src/application/resume/resizeCanvasBlock'
import { setAppearance } from '../../../src/application/resume/setAppearance'
import { setPageSetup } from '../../../src/application/resume/setPageSetup'
import { setTemplate } from '../../../src/application/resume/setTemplate'
import {
  asAttachmentId,
  asCanvasBlockId,
  asTemplateId,
} from '../../../src/domain/shared/branded-id'
import {
  aDocument,
  aResume,
  aTextBlock,
  aTwoColumnDocument,
  attachmentStore,
  contentDeps,
  TestLibrary,
  TestResumeStore,
} from '../../support/resumeFixtures'

function content(store: TestResumeStore) {
  return contentDeps(store, new TestLibrary())
}

describe('setTemplate', () => {
  it('applies the template defaults while keeping the accent colour', async () => {
    const store = new TestResumeStore()
    const before = store.resume.document.appearance.accentColor
    const result = await setTemplate({ resumes: store.repository }, {
      resumeId: store.resumeId,
      templateId: asTemplateId('two-column-sidebar'),
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.templateId).toBe(asTemplateId('two-column-sidebar'))
    expect(resume?.document.pageSetup.columns).toBe(2)
    expect(resume?.document.appearance.accentColor).toBe(before)
    expect(
      resume?.document.sections.find((section) => section.moduleKind === 'skill')?.column,
    ).toBe(1)
    expect(
      resume?.document.sections.find((section) => section.moduleKind === 'project')?.column,
    ).toBe(2)
    expect(result.revision.label).toBe('切换模板')
  })

  it('clamps the sections back to one column on the single-column template', async () => {
    const store = new TestResumeStore(aResume({ document: aTwoColumnDocument() }))
    await setTemplate({ resumes: store.repository }, {
      resumeId: store.resumeId,
      templateId: asTemplateId('classic-single'),
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.pageSetup.columns).toBe(1)
    for (const section of resume?.document.sections ?? []) {
      expect(section.column).toBe(1)
    }
  })

  it('refuses an unknown template', async () => {
    const store = new TestResumeStore()
    await expect(
      setTemplate({ resumes: store.repository }, {
        resumeId: store.resumeId,
        templateId: asTemplateId('gone'),
      }),
    ).rejects.toMatchObject({ code: 'templateNotFound' })
  })
})

describe('setAppearance', () => {
  it('patches the appearance and produces one revision', async () => {
    const store = new TestResumeStore()
    const result = await setAppearance({ resumes: store.repository }, {
      resumeId: store.resumeId,
      patch: { fontScale: 1.15, headingStyle: 'accentBar' },
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.appearance.fontScale).toBe(1.15)
    expect(resume?.document.appearance.headingStyle).toBe('accentBar')
    expect(result.revision.label).toBe('调整外观')
  })

  it('refuses an out-of-range patch without writing', async () => {
    const store = new TestResumeStore()
    await expect(
      setAppearance({ resumes: store.repository }, {
        resumeId: store.resumeId,
        patch: { lineHeight: 3 },
      }),
    ).rejects.toMatchObject({ code: 'invalidSettings' })
    expect(await store.repository.listRevisions(store.resumeId)).toHaveLength(1)
  })
})

describe('setPageSetup', () => {
  it('patches margins and paper within the template rules', async () => {
    const store = new TestResumeStore()
    const result = await setPageSetup({ resumes: store.repository }, {
      resumeId: store.resumeId,
      patch: { marginLeft: 60, marginRight: 60, paper: 'Letter' },
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.pageSetup.paper).toBe('Letter')
    expect(resume?.document.pageSetup.marginLeft).toBe(60)
    expect(result.revision.label).toBe('调整页面')
  })

  it('refuses an unsupported column count and an out-of-range margin', async () => {
    const store = new TestResumeStore()
    const deps = { resumes: store.repository }
    await expect(
      setPageSetup(deps, { resumeId: store.resumeId, patch: { columns: 2 } }),
    ).rejects.toMatchObject({ code: 'invalidPageSetup' })
    await expect(
      setPageSetup(deps, { resumeId: store.resumeId, patch: { marginTop: 10 } }),
    ).rejects.toMatchObject({ code: 'invalidPageSetup' })
  })
})

describe('addCanvasBlock', () => {
  function addDeps(store: TestResumeStore, attachmentIds: readonly string[] = []) {
    return {
      ...content(store),
      attachments: attachmentStore(attachmentIds),
      ids: store.ids,
    }
  }

  it('adds a text block on top of the stack and reports the block', async () => {
    const store = new TestResumeStore(
      aResume({
        document: aDocument({ freeBlocks: [aTextBlock('existing', { x: 80, y: 700 })] }),
      }),
    )
    const result = await addCanvasBlock(addDeps(store), {
      resumeId: store.resumeId,
      kind: 'text',
      pageIndex: 0,
      box: { x: 100, y: 100, width: 120, height: 40 },
      text: '新块',
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.canvas.freeBlocks).toHaveLength(2)
    expect(result.block.zIndex).toBe(1)
    expect(result.revision.label).toBe('添加画布元素')
  })

  it('refuses a page that does not exist and a box outside the page', async () => {
    const store = new TestResumeStore()
    const { pageCount } = await checkLayoutOverflow(content(store), {
      resumeId: store.resumeId,
    })
    await expect(
      addCanvasBlock(addDeps(store), {
        resumeId: store.resumeId,
        kind: 'text',
        pageIndex: pageCount,
        box: { x: 100, y: 100, width: 120, height: 40 },
        text: '越界',
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockOutOfBounds' })
    await expect(
      addCanvasBlock(addDeps(store), {
        resumeId: store.resumeId,
        kind: 'text',
        pageIndex: 0,
        box: { x: 500, y: 100, width: 120, height: 40 },
        text: '越界',
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockOutOfBounds' })
  })

  it('verifies image attachments and requires one', async () => {
    const store = new TestResumeStore()
    await expect(
      addCanvasBlock(addDeps(store), {
        resumeId: store.resumeId,
        kind: 'image',
        pageIndex: 0,
        box: { x: 100, y: 100, width: 80, height: 80 },
      }),
    ).rejects.toMatchObject({ code: 'invalidFieldValue' })
    await expect(
      addCanvasBlock(addDeps(store), {
        resumeId: store.resumeId,
        kind: 'image',
        pageIndex: 0,
        box: { x: 100, y: 100, width: 80, height: 80 },
        attachmentId: asAttachmentId('missing-attachment'),
      }),
    ).rejects.toMatchObject({ code: 'attachmentNotFound' })
    const created = await addCanvasBlock(addDeps(store, ['attachment-1']), {
      resumeId: store.resumeId,
      kind: 'image',
      pageIndex: 0,
      box: { x: 100, y: 100, width: 80, height: 80 },
      attachmentId: asAttachmentId('attachment-1'),
    })
    expect(created.block.attachmentId).toBe('attachment-1')
  })
})

describe('move, resize and remove canvas blocks', () => {
  function storeWithBlocks(): TestResumeStore {
    return new TestResumeStore(
      aResume({
        document: aDocument({
          freeBlocks: [aTextBlock('free-1', { x: 80, y: 700 }), aTextBlock('free-2')],
        }),
      }),
    )
  }

  it('moves a block and changes its paint order', async () => {
    const store = storeWithBlocks()
    const result = await moveCanvasBlock(content(store), {
      resumeId: store.resumeId,
      blockId: asCanvasBlockId('free-1'),
      x: 120,
      y: 600,
      zIndex: 5,
    })
    expect(result.block.x).toBe(120)
    expect(result.block.zIndex).toBe(5)
    expect(result.revision.label).toBe('移动画布元素')
  })

  it('refuses a move outside the page and to a missing page', async () => {
    const store = storeWithBlocks()
    const deps = content(store)
    await expect(
      moveCanvasBlock(deps, {
        resumeId: store.resumeId,
        blockId: asCanvasBlockId('free-1'),
        x: 10_000,
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockOutOfBounds' })
    await expect(
      moveCanvasBlock(deps, {
        resumeId: store.resumeId,
        blockId: asCanvasBlockId('free-1'),
        pageIndex: 9,
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockOutOfBounds' })
    await expect(
      moveCanvasBlock(deps, {
        resumeId: store.resumeId,
        blockId: asCanvasBlockId('missing'),
        x: 10,
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockNotFound' })
  })

  it('resizes a block and refuses a size below the minimum', async () => {
    const store = storeWithBlocks()
    const resized = await resizeCanvasBlock({ resumes: store.repository }, {
      resumeId: store.resumeId,
      blockId: asCanvasBlockId('free-1'),
      width: 160,
      height: 60,
    })
    expect(resized.block.width).toBe(160)
    await expect(
      resizeCanvasBlock({ resumes: store.repository }, {
        resumeId: store.resumeId,
        blockId: asCanvasBlockId('free-1'),
        width: 4,
        height: 60,
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockOutOfBounds' })
  })

  it('removes a block and refuses an unknown one', async () => {
    const store = storeWithBlocks()
    await removeCanvasBlock({ resumes: store.repository }, {
      resumeId: store.resumeId,
      blockId: asCanvasBlockId('free-1'),
    })
    const resume = await store.repository.findById(store.resumeId)
    expect(resume?.document.canvas.freeBlocks.map((block) => block.id)).toEqual(['free-2'])
    await expect(
      removeCanvasBlock({ resumes: store.repository }, {
        resumeId: store.resumeId,
        blockId: asCanvasBlockId('missing'),
      }),
    ).rejects.toMatchObject({ code: 'canvasBlockNotFound' })
  })
})
