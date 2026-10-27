import { describe, expect, it } from 'vitest'
import { materializeBlocks } from '../../../src/application/resume/materializeBlocks'
import { loadResumeExperiences } from '../../../src/application/resume/loadResumeExperiences'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import type { Block } from '../../../src/domain/resume/Block'
import {
  addClaim,
  addVariant,
  createExperience,
} from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAssetId,
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const EXPERIENCE_ID = asExperienceId('experience-1')
const VARIANT_ID = asVariantId('variant-1')
const CONFIRMED_CLAIM_ID = asClaimId('claim-confirmed')
const PENDING_CLAIM_ID = asClaimId('claim-pending')

function experience() {
  const base = createExperience(
    {
      id: EXPERIENCE_ID,
      kind: 'work',
      title: '后端工程师',
      organization: '某公司',
      startDate: null,
      endDate: null,
    },
    NOW,
  )
  const withVariant = addVariant(
    base,
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
  return addClaim(
    addClaim(
      withVariant,
      {
        id: CONFIRMED_CLAIM_ID,
        kind: 'metric',
        statement: '接口可用性 99.99%。',
        sourceField: 'detail.coverage',
        status: 'confirmed',
      },
      NOW,
    ),
    {
      id: PENDING_CLAIM_ID,
      kind: 'responsibility',
      statement: '负责跨团队协作。',
      sourceField: null,
      status: 'pending',
    },
    NOW,
  )
}

function experienceBlock(
  claimIds = [CONFIRMED_CLAIM_ID, PENDING_CLAIM_ID],
  variantId = VARIANT_ID,
): Block {
  return {
    id: asBlockId('block-1'),
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId,
      refVersion: 1,
      claimIds,
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: DEFAULT_TEXT_STYLE,
  }
}

async function materialize(blocks: readonly Block[], repository: InMemoryExperienceRepository) {
  const experiences = await loadResumeExperiences(repository, RESUME_ID, blocks)
  return materializeBlocks(experiences, blocks)
}

describe('materializeBlocks', () => {
  it('inlines the fact fields and the selected variant content', async () => {
    const repository = new InMemoryExperienceRepository()
    repository.seed(experience())

    const [materialized] = await materialize([experienceBlock()], repository)

    expect(materialized?.content).toEqual({
      type: 'experience',
      title: '后端工程师',
      organization: '某公司',
      startDate: null,
      endDate: null,
      variantContent: '负责服务治理。',
    })
    expect(materialized?.textStyle).toEqual(DEFAULT_TEXT_STYLE)
    expect(materialized?.layout).toEqual(DEFAULT_FLOW_LAYOUT)
  })

  it('inlines only confirmed claims', async () => {
    const repository = new InMemoryExperienceRepository()
    repository.seed(experience())

    const [materialized] = await materialize([experienceBlock()], repository)

    expect(materialized?.claims).toEqual([
      {
        claimId: CONFIRMED_CLAIM_ID,
        kind: 'metric',
        statement: '接口可用性 99.99%。',
        sourceField: 'detail.coverage',
      },
    ])
  })

  it('keeps the graphic asset reference and the divider identity', async () => {
    const repository = new InMemoryExperienceRepository()
    repository.seed(experience())

    const materialized = await materialize(
      [
        {
          id: asBlockId('graphic-1'),
          content: { type: 'graphic', assetId: asAssetId('asset-1') },
          layout: DEFAULT_FLOW_LAYOUT,
          textStyle: null,
        },
        {
          id: asBlockId('divider-1'),
          content: { type: 'divider' },
          layout: DEFAULT_FLOW_LAYOUT,
          textStyle: null,
        },
      ],
      repository,
    )

    expect(materialized[0]?.content).toEqual({ type: 'graphic', assetId: 'asset-1' })
    expect(materialized[1]?.content).toEqual({ type: 'divider' })
    expect(materialized[1]?.claims).toHaveLength(0)
  })

  it('inlines the profile fields without the block version', async () => {
    const repository = new InMemoryExperienceRepository()

    const [materialized] = await materialize(
      [
        {
          id: asBlockId('profile-1'),
          content: {
            type: 'profile',
            displayName: '张三',
            email: 'zhang@example.com',
            phone: null,
            links: [{ label: 'GitHub', url: 'https://example.com' }],
            refVersion: 3,
          },
          layout: DEFAULT_FLOW_LAYOUT,
          textStyle: null,
        },
      ],
      repository,
    )

    expect(materialized?.content).toEqual({
      type: 'profile',
      displayName: '张三',
      email: 'zhang@example.com',
      phone: null,
      links: [{ label: 'GitHub', url: 'https://example.com' }],
    })
  })

  it('refuses a variant that no longer exists', async () => {
    const repository = new InMemoryExperienceRepository()
    repository.seed(experience())

    await expect(
      materialize([experienceBlock([], asVariantId('variant-deleted'))], repository),
    ).rejects.toMatchObject({ code: 'variantNotInExperience' })
  })

  it('refuses an experience that no longer exists', async () => {
    await expect(
      materialize([experienceBlock([])], new InMemoryExperienceRepository()),
    ).rejects.toMatchObject({ code: 'variantNotInExperience' })
  })

  it('refuses an unconfirmed variant', async () => {
    const repository = new InMemoryExperienceRepository()
    const draft = addVariant(
      createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW),
      {
        id: VARIANT_ID,
        label: 'Agent 草稿',
        content: '负责服务治理。',
        emphasis: null,
        draftedByRunId: null,
        confirmedAt: null,
      },
      NOW,
    )
    repository.seed(draft)

    await expect(materialize([experienceBlock([])], repository)).rejects.toMatchObject({
      code: 'variantUnconfirmed',
    })
  })

  it('refuses a claim reference that no longer resolves', async () => {
    const repository = new InMemoryExperienceRepository()
    repository.seed(experience())

    await expect(
      materialize([experienceBlock([asClaimId('claim-deleted')])], repository),
    ).rejects.toMatchObject({ code: 'claimRejected' })
  })
})
