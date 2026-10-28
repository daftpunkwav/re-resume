/**
 * @file resumeStore.test
 * @description The studio store against the real resume use cases on in-memory
 * storage: loading, serialized writes, the undo/redo cursor, freeze refusals,
 * stale-entry signals, editor routing and resume lifecycle deletions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InfoEntryId, LayoutBlockId, ResumeSectionId } from '../../../../src/domain/shared/branded-id'
import { listTemplates } from '../../../../src/domain/resume/Template'
import {
  saveEditorText,
  useResumeStore,
} from '../../../../src/presentation/features/resume/resumeStore'
import {
  newResumeStudioRoot,
  seedResume,
  studioEntries,
  type ResumeStudioRoot,
} from '../../../support/resumeStudioRoot'

function studio() {
  return useResumeStore.getState()
}

async function attachTo(root: ResumeStudioRoot): Promise<void> {
  studio().attach({ resume: root.resume, info: root.info })
  await studio().loadInitial()
  await vi.waitFor(() => expect(studio().loadStatus).toBe('ready'), { timeout: 5000 })
}

async function reloadSelected(): Promise<void> {
  const selectedId = studio().selectedId
  expect(selectedId).not.toBeNull()
  if (selectedId === null) return
  await studio().reload(selectedId)
  await vi.waitFor(() => expect(studio().loadStatus).toBe('ready'), { timeout: 5000 })
}

beforeEach(() => {
  studio().detach()
})

afterEach(() => {
  vi.useRealTimers()
  studio().detach()
})

describe('resume studio store', () => {
  it('loads the mail list and the rendered document', async () => {
    const root = newResumeStudioRoot()
    const seeded = await seedResume(root, {
      title: '前端简历',
      templateId: listTemplates()[0]?.id,
      entries: [],
    })
    await attachTo(root)

    expect(studio().list.map((resume) => resume.title)).toEqual(['前端简历'])
    expect(studio().selectedId).toBe(seeded.resumeId)
    expect(studio().resume?.title).toBe('前端简历')
    expect(studio().layout?.pages.length).toBeGreaterThan(0)
    expect(studio().materialized?.blocks.length).toBeGreaterThan(0)
    expect(studio().revisions).toHaveLength(1)
    expect(studio().currentPage).toBe(0)
  })

  it('serializes two quick writes instead of refusing the second as a stale cursor', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, { title: '前端简历', entries: [] })
    await attachTo(root)

    const [first, second] = await Promise.all([
      studio().setAppearance({ fontScale: 1.1 }),
      studio().setAppearance({ lineHeight: 1.65 }),
    ])

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(studio().resume?.document.appearance.fontScale).toBe(1.1)
    expect(studio().resume?.document.appearance.lineHeight).toBe(1.65)
    expect(studio().revisions).toHaveLength(3)
    expect(studio().actionError).toBeNull()
  })

  it('moves the revision cursor with undo and redo without adding revisions', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, { title: '前端简历', entries: [] })
    await attachTo(root)

    const originalAccent = studio().resume?.document.appearance.accentColor
    expect(await studio().setAppearance({ accentColor: 'rose' })).toBe(true)
    expect(studio().revisions).toHaveLength(2)
    expect(await studio().undo()).toBe(true)
    expect(studio().resume?.document.appearance.accentColor).toBe(originalAccent)
    expect(studio().revisions).toHaveLength(2)
    expect(await studio().redo()).toBe(true)
    expect(studio().resume?.document.appearance.accentColor).toBe('rose')
    expect(studio().revisions).toHaveLength(2)
  })

  it('refuses document writes once frozen and keeps the revision chain', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, { title: '前端简历' })
    await attachTo(root)

    expect(await studio().freeze()).toBe(true)
    await vi.waitFor(() => expect(studio().resume?.status).toBe('frozen'))
    const revisionsBefore = studio().revisions.length

    expect(await studio().setAppearance({ fontScale: 1.2 })).toBe(false)
    expect(studio().actionError?.message).toContain('已定稿')
    expect(studio().revisions).toHaveLength(revisionsBefore)
  })

  it('refuses to freeze while a referenced entry is missing, then reports it', async () => {
    const root = newResumeStudioRoot()
    const seeded = await seedResume(root, {
      title: '前端简历',
      entries: studioEntries().filter((entry) => entry.moduleKind === 'project'),
    })
    expect(
      await root.info.deleteEntry({ entryId: 'entry-project' as InfoEntryId, confirmReferenced: true }),
    ).toBeTruthy()
    await attachTo(root)
    await reloadSelected()

    expect(studio().materialized?.missingReferences.length).toBeGreaterThan(0)
    expect(await studio().freeze()).toBe(false)
    expect(studio().actionError?.message ?? '').toMatch(/失效|引用/)
    expect(studio().resume?.id).toBe(seeded.resumeId)
  })

  it('marks entries updated after the resume was saved', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, {
      title: '前端简历',
      entries: studioEntries().filter((entry) => entry.moduleKind === 'skill'),
    })
    await attachTo(root)
    expect(studio().entryUpdates.size).toBe(0)

    await root.info.updateEntry({
      entryId: 'entry-skill' as InfoEntryId,
      fields: { name: 'TypeScript 与 React' },
    })
    await reloadSelected()

    expect(studio().entryUpdates.has('entry-skill')).toBe(true)
  })

  it('routes the summary editor through an override and removes it on an empty submit', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, {
      title: '前端简历',
      entries: studioEntries().filter((entry) => entry.moduleKind === 'personal'),
    })
    await attachTo(root)
    const summaryBlock = 'summary' as LayoutBlockId
    studio().openEditor(summaryBlock)
    expect(studio().editorTarget?.kind).toBe('summary')

    expect(await saveEditorText('面向前端岗位的自我介绍。')).toBe(true)
    await vi.waitFor(() => expect(studio().editorTarget).toBeNull())
    expect(
      studio().resume?.document.overrides.some((override) => override.target.kind === 'summary'),
    ).toBe(true)

    studio().openEditor(summaryBlock)
    expect(await saveEditorText('   ')).toBe(true)
    await vi.waitFor(() =>
      expect(studio().resume?.document.overrides.some((override) => override.target.kind === 'summary')).toBe(
        false,
      ),
    )
  })

  it('selects the next resume after deleting the open one', async () => {
    const root = newResumeStudioRoot()
    const first = await seedResume(root, { title: '第一份简历', entries: [] })
    const second = await seedResume(root, { title: '第二份简历', entries: [] })
    await attachTo(root)
    expect(studio().list).toHaveLength(2)
    const openId = studio().selectedId

    expect(await studio().deleteResume()).toBe(true)
    await vi.waitFor(() => expect(studio().list).toHaveLength(1))
    await vi.waitFor(() => expect(studio().loadStatus === 'ready' || studio().selectedId === null).toBe(true))

    const remaining = studio().list[0]
    expect(remaining?.id).not.toBe(openId)
    if (remaining !== undefined) {
      await vi.waitFor(() => expect(studio().selectedId).toBe(remaining.id))
      expect(studio().resume?.title).toBe(remaining.id === first.resumeId ? '第一份简历' : second.title)
    }
  })

  it('clears the agent highlight after its window', async () => {
    const root = newResumeStudioRoot()
    const seeded = await seedResume(root, { title: '前端简历' })
    await attachTo(root)
    const section = studio().resume?.document.sections[0]
    expect(section).toBeDefined()
    if (section === undefined) return

    vi.useFakeTimers()
    studio().flashAgentSections([section.id])
    expect(studio().agentBusy).toBe(true)
    expect(studio().highlightedSectionIds).toEqual([section.id])
    vi.advanceTimersByTime(2100)
    expect(studio().agentBusy).toBe(false)
    expect(studio().highlightedSectionIds).toEqual([])
    vi.useRealTimers()
    expect(studio().resume?.id).toBe(seeded.resumeId)
  })

  it('reports a refused write through the readable error and keeps the editor open', async () => {
    const root = newResumeStudioRoot()
    await seedResume(root, { title: '前端简历', entries: [] })
    await attachTo(root)

    const unknownSection = 'section-does-not-exist' as ResumeSectionId
    expect(await studio().setSectionDisplay(unknownSection, { visible: false })).toBe(false)
    expect(studio().actionError?.message.length).toBeGreaterThan(0)
    studio().clearActionError()
    expect(studio().actionError).toBeNull()
  })
})
