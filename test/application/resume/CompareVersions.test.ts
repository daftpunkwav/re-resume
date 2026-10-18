import { describe, expect, it } from 'vitest'
import { compareVersions } from '../../../src/application/resume/CompareVersions'
import type { VersionSelector } from '../../../src/application/resume/CompareVersions'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import type { PageSetup } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asBlockId, asResumeId, asRevisionId, asSnapshotId } from '../../../src/domain/shared/branded-id'
import type { RevisionId } from '../../../src/domain/shared/branded-id'
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

function revisionAt(repo: InMemoryResumeRepository, seq: number): VersionSelector {
  const found = repo.historyOf(RESUME_ID).find((revision) => revision.seq === seq)
  if (found === undefined) throw new Error(`no revision with seq ${seq}`)
  return { kind: 'revision', id: found.id as RevisionId }
}

async function commit(repo: InMemoryResumeRepository, blocks: readonly Block[], label: string) {
  await commitDocumentChange(
    repo,
    new InMemoryExperienceRepository(),
    RESUME_ID,
    describeChange({ label, origin: 'user', runId: null }, () => ({ blocks, pageSetup: A4_PAGE_SETUP })),
  )
}

async function seededResume(): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW)
  const state = {
    blocks: [textBlock('block-1', '第一段。'), textBlock('block-2', '第二段。')],
    pageSetup: A4_PAGE_SETUP,
  }
  await repo.insertWithInitialRevision(
    // Hydrated from its current revision, the way a repository reading the
    // row would return it.
    setDocument(
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
      state,
      INITIAL_REVISION_ID,
      NOW,
    ),
    initialRevision(RESUME_ID, INITIAL_REVISION_ID, state, NOW),
  )
  return repo
}

describe('compareVersions', () => {
  it('reports an added, a removed, an edited and a reordered block', async () => {
    const repo = await seededResume()
    await commit(
      repo,
      [textBlock('block-2', '第二段。'), textBlock('block-3', '第三段。'), textBlock('block-1', '第一段改。')],
      '重排并改写',
    )

    const diff = await compareVersions(repo, revisionAt(repo, 1), revisionAt(repo, 2))

    expect(diff.from).toEqual({
      kind: 'revision',
      id: INITIAL_REVISION_ID,
      label: '#1 创建简历',
    })
    expect(diff.to).toEqual({ kind: 'revision', id: diff.to.id, label: '#2 重排并改写' })
    expect(diff.pageSetupChanged).toBe(false)
    expect(diff.changes.map((entry) => [entry.kind, entry.blockId])).toEqual([
      ['content-changed', asBlockId('block-1')],
      ['reordered', asBlockId('block-2')],
      ['added', asBlockId('block-3')],
    ])
    expect(diff.changes[0]).toMatchObject({ fromIndex: 0, toIndex: 2 })
    expect(diff.changes[1]).toMatchObject({ fromIndex: 1, toIndex: 0 })
    expect(diff.changes[2]).toMatchObject({ fromIndex: null, toIndex: 1 })
  })

  it('labels a block by its content so a diff row reads without the document', async () => {
    const repo = await seededResume()
    await commit(repo, [textBlock('block-1', '改写后的第一段。')], '改写')

    const diff = await compareVersions(repo, revisionAt(repo, 1), revisionAt(repo, 2))

    // An edited row shows the current text; a removed row shows what is gone.
    expect(diff.changes.map((entry) => entry.label)).toEqual([
      'text: 改写后的第一段。',
      'text: 第二段。',
    ])
  })

  it('shortens a long block label', async () => {
    const repo = await seededResume()
    await commit(repo, [textBlock('block-1', '甲'.repeat(40))], '改写')

    const diff = await compareVersions(repo, revisionAt(repo, 1), revisionAt(repo, 2))

    expect(diff.changes[0]?.label).toBe(`text: ${'甲'.repeat(24)}…`)
  })

  it('reports a page setup change', async () => {
    const repo = await seededResume()
    const wide: PageSetup = { ...A4_PAGE_SETUP, marginTop: 36 }
    await commitDocumentChange(
      repo,
      new InMemoryExperienceRepository(),
      RESUME_ID,
      describeChange({ label: '调整页边距', origin: 'user', runId: null }, (state) => ({
        ...state,
        pageSetup: wide,
      })),
    )

    const diff = await compareVersions(repo, revisionAt(repo, 1), revisionAt(repo, 2))

    expect(diff.pageSetupChanged).toBe(true)
    expect(diff.changes).toHaveLength(0)
  })

  it('compares a snapshot against the revision it was frozen from', async () => {
    const repo = await seededResume()
    const snapshot = await freezeResume(
      repo,
      new InMemoryExperienceRepository(),
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )

    const diff = await compareVersions(
      repo,
      revisionAt(repo, 1),
      { kind: 'snapshot', id: snapshot.id },
    )

    expect(diff.to).toEqual({ kind: 'snapshot', id: snapshot.id, label: '快照 #1' })
    // Materialized content compares equal to the live block it came from.
    expect(diff.changes).toHaveLength(0)
  })

  it('reports the missing version rather than an empty diff', async () => {
    const repo = await seededResume()

    await expect(
      compareVersions(repo, revisionAt(repo, 1), {
        kind: 'snapshot',
        id: asSnapshotId('snapshot-missing'),
      }),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
  })
})
