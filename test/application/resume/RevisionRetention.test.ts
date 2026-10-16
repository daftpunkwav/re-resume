/**
 * Revision retention: what the repository keeps, what it drops, and what stays
 * reachable through undo and redo. Exercised through the use cases rather than
 * by inspecting repository internals, because reachability is the contract
 * that matters to the editor.
 */

import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { redoDocumentChange } from '../../../src/application/resume/RedoDocumentChange'
import { undoDocumentChange } from '../../../src/application/resume/UndoDocumentChange'
import type { LiveRevisionChain } from '../../../src/application/resume/UndoDocumentChange'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume } from '../../../src/domain/resume/Resume'
import { isLiveRevision } from '../../../src/domain/resume/Revision'
import type { Revision } from '../../../src/domain/resume/Revision'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import type { Block } from '../../../src/domain/resume/Block'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asBlockId, asResumeId, asRevisionId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const REVISION_LIMIT = 3

function textBlock(index: number): Block {
  return {
    id: asBlockId(`block-${index}`),
    content: { type: 'text', text: `第 ${index} 段。` },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

/** A resume holding only its initial revision, with the chain limit under test. */
async function resumeWithRevisionLimit(): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW, REVISION_LIMIT)
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
  return repo
}

async function appendParagraph(repo: InMemoryResumeRepository, index: number): Promise<Revision> {
  return commitDocumentChange(
    repo,
    new InMemoryExperienceRepository(),
    RESUME_ID,
    describeChange({ label: `第 ${index} 段`, origin: 'user', runId: null }, (state) => ({
      ...state,
      blocks: [...state.blocks, textBlock(index)],
    })),
  )
}

function chainOf(repo: InMemoryResumeRepository): LiveRevisionChain {
  return (resumeId) => repo.historyOf(resumeId)
}

function seqsOf(repo: InMemoryResumeRepository): readonly number[] {
  return repo.historyOf(RESUME_ID).map((revision) => revision.seq)
}

function liveSeqsOf(repo: InMemoryResumeRepository): readonly number[] {
  return repo.historyOf(RESUME_ID).filter(isLiveRevision).map((revision) => revision.seq)
}

describe('revision retention', () => {
  it('keeps the abandoned row when a change is committed after an undo', async () => {
    const repo = await resumeWithRevisionLimit()
    await appendParagraph(repo, 1)
    await appendParagraph(repo, 2)
    const abandoned = repo.historyOf(RESUME_ID).find((revision) => revision.seq === 3)

    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    const added = await appendParagraph(repo, 3)

    const survivor = repo.historyOf(RESUME_ID).find((revision) => revision.seq === 3)
    expect(survivor).toBeDefined()
    expect(survivor?.id).toBe(abandoned?.id)
    expect(survivor?.id).not.toBe(added.id)
    expect(survivor?.label).toBe('第 2 段')
    expect(survivor?.supersededAt).not.toBeNull()
    expect(liveSeqsOf(repo)).toEqual([1, 2, 4])
  })

  it('keeps the newest window of live revisions and trims the rest', async () => {
    const repo = await resumeWithRevisionLimit()
    for (let index = 1; index <= 5; index += 1) await appendParagraph(repo, index)

    // Trimming runs right after a commit, when the cursor is the chain tail, so
    // the cut lands on the window start and the window is what survives.
    expect(liveSeqsOf(repo)).toEqual([4, 5, 6])
    expect(liveSeqsOf(repo)).toHaveLength(REVISION_LIMIT)
    expect(await repo.readRevision(INITIAL_REVISION_ID)).toBeNull()
  })

  it('keeps everything when the chain never reaches the window', async () => {
    const repo = await resumeWithRevisionLimit()
    await appendParagraph(repo, 1)

    expect(liveSeqsOf(repo)).toEqual([1, 2])
    expect(liveSeqsOf(repo)).toHaveLength(2)
  })

  it('never trims an abandoned branch', async () => {
    const repo = await resumeWithRevisionLimit()
    for (let index = 1; index <= 5; index += 1) await appendParagraph(repo, index)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)

    await appendParagraph(repo, 6)

    const abandoned = repo.historyOf(RESUME_ID).filter(
      (revision) => revision.seq === 5 || revision.seq === 6,
    )
    expect(abandoned).toHaveLength(2)
    for (const revision of abandoned) {
      expect(revision.supersededAt).not.toBeNull()
      expect(revision.label).not.toBe('第 6 段')
    }
    expect(liveSeqsOf(repo)).toEqual([4, 7])
  })

  it('reaches the previous live revision through undo after a trim', async () => {
    const repo = await resumeWithRevisionLimit()
    for (let index = 1; index <= 5; index += 1) await appendParagraph(repo, index)

    const first = await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    expect(first.seq).toBe(5)
    const second = await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    expect(second.seq).toBe(4)

    // The window start is the floor of the chain, not the initial revision.
    await expect(undoDocumentChange(repo, chainOf(repo), RESUME_ID)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
  })

  it('keeps the redo path reachable after a trim', async () => {
    const repo = await resumeWithRevisionLimit()
    for (let index = 1; index <= 5; index += 1) await appendParagraph(repo, index)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)
    await undoDocumentChange(repo, chainOf(repo), RESUME_ID)

    const forward = await redoDocumentChange(repo, chainOf(repo), RESUME_ID)
    expect(forward.seq).toBe(5)
    const head = await redoDocumentChange(repo, chainOf(repo), RESUME_ID)
    expect(head.seq).toBe(6)
    expect(seqsOf(repo)).toEqual([4, 5, 6])
  })
})
