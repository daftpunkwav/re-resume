import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import { undoDocumentChange } from '../../../src/application/resume/UndoDocumentChange'
import type { LiveRevisionChain } from '../../../src/application/resume/UndoDocumentChange'
import { isLiveRevision } from '../../../src/domain/resume/Revision'
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

function chainOf(repo: InMemoryResumeRepository): LiveRevisionChain {
  return (resumeId) => repo.historyOf(resumeId)
}

/** A resume with three revisions: the initial one plus two committed blocks. */
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

describe('undoDocumentChange', () => {
  it('moves the cursor back one revision without creating one', async () => {
    const repo = await resumeWithTwoCommits()
    const before = repo.historyOf(RESUME_ID)

    const target = await undoDocumentChange(repo, chainOf(repo), RESUME_ID)

    expect(target.seq).toBe(2)
    const after = repo.historyOf(RESUME_ID)
    expect(after).toHaveLength(before.length)
    expect(after.map((revision) => revision.id)).toEqual(
      before.map((revision) => revision.id),
    )
    const stored = await repo.findById(RESUME_ID)
    expect(stored?.currentRevision).toBe(target.id)
    expect(stored?.blocks.map((block) => block.id)).toEqual([asBlockId('block-1')])
  })

  it('stops at the initial revision', async () => {
    const repo = await resumeWithTwoCommits()

    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)

    await expect(undoDocumentChange(repo, chainOf(repo), RESUME_ID)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
    const stored = await repo.findById(RESUME_ID)
    expect(stored?.currentRevision).toBe(INITIAL_REVISION_ID)
    expect(stored?.blocks).toHaveLength(0)
    expect(repo.historyOf(RESUME_ID)).toHaveLength(3)
  })

  it('supersedes the abandoned branch when a change is committed after undo', async () => {
    const repo = await resumeWithTwoCommits()
    const abandoned = repo.historyOf(RESUME_ID).find((entry) => entry.seq === 3)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)

    const revision = await commitDocumentChange(
      repo,
      new InMemoryExperienceRepository(),
      RESUME_ID,
      appending(textBlock('block-3', '改写后的第一段。'), '改写第一段'),
    )

    // seq continues past every row that exists, the abandoned one included,
    // and is never reused.
    const history = repo.historyOf(RESUME_ID)
    expect(revision.seq).toBe(4)
    expect(revision.seq).toBeGreaterThan(3)
    expect(history.filter(isLiveRevision).map((entry) => entry.seq)).toEqual([1, 2, 4])

    // The abandoned state is unreachable: undo lands on the revision the cursor
    // was on before the branch was abandoned, never on the abandoned row.
    const target = await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    expect(target.seq).toBe(2)
    expect(target.id).not.toBe(abandoned?.id)
    const stored = await repo.findById(RESUME_ID)
    expect(stored?.blocks.map((block) => block.id)).toEqual([asBlockId('block-1')])
  })

  it('refuses a frozen resume', async () => {
    const repo = await resumeWithTwoCommits()
    await freezeResume(
      repo,
      new InMemoryExperienceRepository(),
      chainOf(repo),
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    await expect(undoDocumentChange(repo, chainOf(repo), RESUME_ID)).rejects.toMatchObject({
      code: 'frozenResumeImmutable',
    })
  })
})
