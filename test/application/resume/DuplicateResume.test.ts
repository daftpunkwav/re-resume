import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { duplicateResume } from '../../../src/application/resume/DuplicateResume'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import type { LiveRevisionChain } from '../../../src/application/resume/UndoDocumentChange'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { updateProfile } from '../../../src/domain/catalog/Profile'
import {
  addClaim,
  addVariant,
  createExperience,
  updateFact,
} from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import {
  InMemoryExperienceRepository,
  InMemoryProfileRepository,
} from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const EXPERIENCE_ID = asExperienceId('experience-1')
const VARIANT_ID = asVariantId('variant-1')

function experienceRepoWithFactsBumped(): InMemoryExperienceRepository {
  const repository = new InMemoryExperienceRepository()
  const withVariant = addVariant(
    createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
    {
      id: VARIANT_ID,
      label: '架构导向',
      content: '负责服务治理。',
      emphasis: null,
      draftedByRunId: null,
      confirmedAt: NOW,
    },
    NOW,
  )
  repository.seed(updateFact(withVariant, { title: '高级后端工程师' }, NOW))
  return repository
}

function sourceBlocks(): Block[] {
  return [
    {
      id: asBlockId('profile-1'),
      content: {
        type: 'profile',
        displayName: '张三',
        email: 'zhang@example.com',
        phone: null,
        links: [],
        refVersion: 1,
      },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    },
    {
      id: asBlockId('experience-1'),
      content: {
        type: 'experience',
        experienceId: EXPERIENCE_ID,
        variantId: VARIANT_ID,
        refVersion: 1,
        claimIds: [],
      },
      layout: DEFAULT_FLOW_LAYOUT,
      textStyle: null,
    },
  ]
}

function chainOf(repo: InMemoryResumeRepository): LiveRevisionChain {
  return (resumeId) => repo.historyOf(resumeId)
}

async function seededResume(
  blocks: readonly Block[] = sourceBlocks(),
): Promise<InMemoryResumeRepository> {
  const repo = new InMemoryResumeRepository(() => NOW)
  const state = { blocks, pageSetup: A4_PAGE_SETUP }
  await repo.insertWithInitialRevision(
    // Hydrated from its current revision, the way a repository reading the
    // row would return it.
    setDocument(
      createResume(
        {
          id: RESUME_ID,
          title: '简历',
          targetRole: '后端工程师',
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

async function profileRepoAtVersion(version: number): Promise<InMemoryProfileRepository> {
  const repository = InMemoryProfileRepository.seeded(NOW)
  let profile = await repository.get()
  for (let index = 1; index < version; index += 1) {
    profile = updateProfile(profile, { displayName: `张三 ${index}` }, NOW)
    await repository.save(profile)
  }
  return repository
}

describe('duplicateResume', () => {
  it('copies the document into a new draft with its own history', async () => {
    const repo = await seededResume()
    const profileRepo = await profileRepoAtVersion(4)

    const copyId = await duplicateResume(
      repo,
      repo,
      experienceRepoWithFactsBumped(),
      profileRepo,
      new SequentialIdGenerator('copy'),
      new FixedClock(),
      { sourceResumeId: RESUME_ID },
    )

    const copy = await repo.findById(copyId)
    expect(copy?.status).toBe('draft')
    expect(copy?.title).toBe('简历（副本）')
    expect(copy?.targetRole).toBe('后端工程师')
    expect(copy?.pageSetup).toEqual(A4_PAGE_SETUP)
    expect(copy?.snapshots).toHaveLength(0)
    expect(repo.historyOf(copyId)).toHaveLength(1)
    expect(repo.historyOf(copyId)[0]?.seq).toBe(1)
    expect(copyId).not.toBe(RESUME_ID)
  })

  it('regenerates block ids and rebases the reference versions', async () => {
    const repo = await seededResume()
    const experienceRepo = experienceRepoWithFactsBumped()

    const copyId = await duplicateResume(
      repo,
      repo,
      experienceRepo,
      await profileRepoAtVersion(4),
      new SequentialIdGenerator('copy'),
      new FixedClock(),
      { sourceResumeId: RESUME_ID },
    )

    const copy = await repo.findById(copyId)
    const sourceIds = sourceBlocks().map((block) => block.id)
    expect(copy?.blocks.map((block) => block.id)).not.toEqual(sourceIds)
    const experienceBlock = copy?.blocks.find(
      (block) => block.content.type === 'experience',
    )
    expect(experienceBlock?.content).toMatchObject({
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      refVersion: (await experienceRepo.findById(EXPERIENCE_ID))?.factVersion,
    })
    const profileBlock = copy?.blocks.find((block) => block.content.type === 'profile')
    expect(profileBlock?.content).toMatchObject({
      displayName: '张三',
      refVersion: 4,
    })
  })

  it('duplicates a frozen resume, which is the only path back to a draft', async () => {
    const repo = await seededResume()
    const experienceRepo = experienceRepoWithFactsBumped()
    const profileRepo = await profileRepoAtVersion(2)
    await freezeResume(
      repo,
      experienceRepo,
      chainOf(repo),
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )
    expect((await repo.findById(RESUME_ID))?.status).toBe('frozen')

    const copyId = await duplicateResume(
      repo,
      repo,
      experienceRepo,
      profileRepo,
      new SequentialIdGenerator('copy'),
      new FixedClock(),
      { sourceResumeId: RESUME_ID },
    )

    const copy = await repo.findById(copyId)
    expect(copy?.status).toBe('draft')
    expect(copy?.snapshots).toHaveLength(0)
    expect(copy?.blocks).toHaveLength(2)
    // The frozen source keeps its snapshot.
    expect((await repo.findById(RESUME_ID))?.snapshots).toHaveLength(1)
  })

  it('carries no revision history over', async () => {
    const repo = await seededResume()
    const experienceRepo = experienceRepoWithFactsBumped()
    await commitDocumentChange(
      repo,
      experienceRepo,
      RESUME_ID,
      describeChange({ label: '加一段', origin: 'user', runId: null }, (state) => ({
        ...state,
        blocks: [
          ...state.blocks,
          {
            id: asBlockId('text-1'),
            content: { type: 'text', text: '第三段。' },
            layout: DEFAULT_FLOW_LAYOUT,
            textStyle: null,
          },
        ],
      })),
    )

    const copyId = await duplicateResume(
      repo,
      repo,
      experienceRepo,
      await profileRepoAtVersion(2),
      new SequentialIdGenerator('copy'),
      new FixedClock(),
      { sourceResumeId: RESUME_ID },
    )

    expect(repo.historyOf(copyId)).toHaveLength(1)
    expect(repo.historyOf(RESUME_ID)).toHaveLength(2)
  })

  it('refuses to copy a block whose experience no longer exists', async () => {
    const repo = await seededResume()

    await expect(
      duplicateResume(
        repo,
        repo,
        new InMemoryExperienceRepository(),
        await profileRepoAtVersion(1),
        new SequentialIdGenerator('copy'),
        new FixedClock(),
        { sourceResumeId: RESUME_ID },
      ),
    ).rejects.toMatchObject({ code: 'variantNotInExperience' })
  })

  it('refuses to carry a claim the user rejected after the revision was saved', async () => {
    // The document was saved while the claim was still accepted; rejecting it
    // afterwards has to stop the copy rather than carry it into a new resume
    // that no editor ever chose it for.
    const source = sourceBlocks().map((block) =>
      block.content.type === 'experience'
        ? { ...block, content: { ...block.content, claimIds: [asClaimId('claim-1')] } }
        : block,
    )
    const repo = await seededResume(source)
    const catalog = new InMemoryExperienceRepository()
    const experience = await experienceRepoWithFactsBumped().findById(EXPERIENCE_ID)
    if (experience === null) throw new Error('the seeded experience should exist')
    catalog.seed(
      addClaim(
        experience,
        {
          id: asClaimId('claim-1'),
          kind: 'metric',
          statement: '日均千万笔',
          sourceField: null,
          status: 'rejected',
        },
        NOW,
      ),
    )

    await expect(
      duplicateResume(
        repo,
        repo,
        catalog,
        await profileRepoAtVersion(1),
        new SequentialIdGenerator('copy'),
        new FixedClock(),
        { sourceResumeId: RESUME_ID },
      ),
    ).rejects.toMatchObject({ code: 'claimRejected' })

    expect(await repo.listAll()).toHaveLength(1)
  })

  it('copies the profile fields the source document holds', async () => {
    const repo = await seededResume()
    const profileRepo = InMemoryProfileRepository.seeded(NOW)
    await profileRepo.save(
      updateProfile(await profileRepo.get(), { displayName: '李四', phone: '13800000000' }, NOW),
    )

    const copyId = await duplicateResume(
      repo,
      repo,
      experienceRepoWithFactsBumped(),
      profileRepo,
      new SequentialIdGenerator('copy'),
      new FixedClock(),
      { sourceResumeId: RESUME_ID },
    )

    const profileBlock = (await repo.findById(copyId))?.blocks.find(
      (block) => block.content.type === 'profile',
    )
    // The copy carries the source document's contact details, not the profile
    // as it stands now; only the reference version is rebased.
    expect(profileBlock?.content).toEqual({
      type: 'profile',
      displayName: '张三',
      email: 'zhang@example.com',
      phone: null,
      links: [],
      refVersion: (await profileRepo.get()).version,
    })
  })
})
