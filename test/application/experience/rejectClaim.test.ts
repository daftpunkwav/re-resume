import { describe, expect, it } from 'vitest'
import { addClaim } from '../../../src/application/experience/AddClaim'
import { rejectClaim } from '../../../src/application/experience/RejectClaim'
import type { RejectClaimDeps } from '../../../src/application/experience/RejectClaim'
import { createExperience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const STATEMENT = '把构建时间从 40 分钟降到 6 分钟'

function setup(): { deps: RejectClaimDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  repo.seed(createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW))
  return { repo, deps: { experienceRepo: repo, clock: new FixedClock(NOW) } }
}

describe('rejectClaim', () => {
  it('moves a pending assertion to rejected', async () => {
    const { deps, repo } = setup()
    const seeded = await addClaim(
      { experienceRepo: repo, clock: new FixedClock(NOW), ids: new SequentialIdGenerator('claim') },
      { experienceId: EXPERIENCE_ID, kind: 'metric', statement: STATEMENT },
    )
    if (!seeded.ok) throw new Error('fixture not created')
    const claimId = seeded.value.claims[0]!.id

    const updated = await rejectClaim(deps, EXPERIENCE_ID, claimId)

    expect(updated.claims[0]?.status).toBe('rejected')
  })

  it('leaves the fact version alone and writes only the experience aggregate', async () => {
    const { deps, repo } = setup()
    const seeded = await addClaim(
      { experienceRepo: repo, clock: new FixedClock(NOW), ids: new SequentialIdGenerator('claim') },
      { experienceId: EXPERIENCE_ID, kind: 'metric', statement: STATEMENT },
    )
    if (!seeded.ok) throw new Error('fixture not created')
    const claimId = seeded.value.claims[0]!.id

    await rejectClaim(deps, EXPERIENCE_ID, claimId)

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('frees the statement key, so the same wording can be added again', async () => {
    const { deps, repo } = setup()
    const addDeps = {
      experienceRepo: repo,
      clock: new FixedClock(NOW),
      ids: new SequentialIdGenerator('claim'),
    }
    const seeded = await addClaim(addDeps, {
      experienceId: EXPERIENCE_ID,
      kind: 'metric',
      statement: STATEMENT,
    })
    if (!seeded.ok) throw new Error('fixture not created')
    const firstClaimId = seeded.value.claims[0]!.id

    await rejectClaim(deps, EXPERIENCE_ID, firstClaimId)

    const readded = await addClaim(addDeps, {
      experienceId: EXPERIENCE_ID,
      kind: 'metric',
      statement: STATEMENT,
    })
    expect(readded.ok).toBe(true)
    if (!readded.ok) return
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims).toHaveLength(2)
    expect(stored?.claims.map((claim) => claim.status)).toEqual(['rejected', 'pending'])
    expect(readded.value.claims[1]?.id).toBe('claim-2')
  })
})
