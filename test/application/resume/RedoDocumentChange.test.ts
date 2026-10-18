import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import { redoDocumentChange } from '../../../src/application/resume/RedoDocumentChange'
import { undoDocumentChange } from '../../../src/application/resume/UndoDocumentChange'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asBlockId, asResumeId, asRevisionId } from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')

function textBlock(id: string, text: string): Block {
  return {
    id: asBlockId(id),
    content: { type: 'text', text },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function appending(block: Block, label: string) {
  return describeChange({ label, origin: 'user', runId: null }, (state) => ({
    ...state,
    blocks: [...state.blocks, block],
  }))
}

async function resumeWithTwoCommits(): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW)
  await repo.insertWithInitialRevision(
    createResume(
      {
        id: RESUME_ID,
        title: '简历',
        targetRole: null,
        pageSetup: A4_PAGE_SETUP,
        initialRevisionId: INITIAL_REVISION_ID,
      },
      NOW,
    ),
    initialRevision(
      RESUME_ID,
      INITIAL_REVISION_ID,
      { blocks: [], pageSetup: A4_PAGE_SETUP },
      NOW,
    ),
  )
  const experienceRepo = new InMemoryExperienceRepository()
  await commitDocumentChange(
    repo,
    experienceRepo,
    RESUME_ID,
    appending(textBlock('block-1', '第一段。'), '添加第一段'),
  )
  await commitDocumentChange(
    repo,
    experienceRepo,
    RESUME_ID,
    appending(textBlock('block-2', '第二段。'), '添加第二段'),
  )
  return repo
}

describe('redoDocumentChange', () => {
  it('moves the cursor forward one revision without creating one', async () => {
    const repo = await resumeWithTwoCommits()
    await undoDocumentChange(repo, RESUME_ID)
    const before = repo.historyOf(RESUME_ID)

    const target = await redoDocumentChange(repo, RESUME_ID)

    expect(target.seq).toBe(3)
    expect(repo.historyOf(RESUME_ID)).toHaveLength(before.length)
    const stored = await repo.findById(RESUME_ID)
    expect(stored?.currentRevision).toBe(target.id)
    expect(stored?.blocks.map((block) => block.id)).toEqual([
      asBlockId('block-1'),
      asBlockId('block-2'),
    ])
  })

  it('refuses to move past the newest revision', async () => {
    const repo = await resumeWithTwoCommits()

    await expect(redoDocumentChange(repo, RESUME_ID)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
    expect(repo.historyOf(RESUME_ID)).toHaveLength(3)
  })

  it('does not offer an abandoned branch as redoable history', async () => {
    const repo = await resumeWithTwoCommits()
    await undoDocumentChange(repo, RESUME_ID)
    await commitDocumentChange(
      repo,
      new InMemoryExperienceRepository(),
      RESUME_ID,
      appending(textBlock('block-3', '改写后的第一段。'), '改写第一段'),
    )

    await expect(redoDocumentChange(repo, RESUME_ID)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
    const stored = await repo.findById(RESUME_ID)
    expect(stored?.blocks.map((block) => block.id)).toEqual([
      asBlockId('block-1'),
      asBlockId('block-3'),
    ])
  })

  it('refuses a frozen resume', async () => {
    const repo = await resumeWithTwoCommits()
    await freezeResume(
      repo,
      new InMemoryExperienceRepository(),
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    await expect(redoDocumentChange(repo, RESUME_ID)).rejects.toMatchObject({
      code: 'frozenResumeImmutable',
    })
  })
})
