import { describe, expect, it } from 'vitest'
import { addClaim } from '../../../src/application/experience/AddClaim'
import type { AddClaimDeps } from '../../../src/application/experience/AddClaim'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')
const STATEMENT = '把构建时间从 40 分钟降到 6 分钟'

function workExperience(): Experience {
  return createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW)
}

function setup(): { deps: AddClaimDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  repo.seed(workExperience())
  return {
    repo,
    deps: {
      experienceRepo: repo,
      clock: new FixedClock(NOW),
      ids: new SequentialIdGenerator('claim'),
    },
  }
}

describe('addClaim', () => {
  it('stores a new assertion as pending, because confirmation is its only onward move', async () => {
    const { deps, repo } = setup()

    const result = await addClaim(deps, {
      experienceId: EXPERIENCE_ID,
      kind: 'metric',
      statement: STATEMENT,
      sourceField: 'detail.highlights.0',
    })

    expect(result.ok).toBe(true)
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims[0]?.status).toBe('pending')
    expect(stored?.claims[0]?.id).toBe('claim-1')
    expect(stored?.claims[0]?.sourceField).toBe('detail.highlights.0')
  })

  it('leaves the fact version alone, because a claim is not a fact change', async () => {
    const { deps, repo } = setup()

    await addClaim(deps, { experienceId: EXPERIENCE_ID, kind: 'metric', statement: STATEMENT })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(1)
  })

  it('refuses a statement that is already active on this experience', async () => {
    const { deps, repo } = setup()

    await addClaim(deps, { experienceId: EXPERIENCE_ID, kind: 'metric', statement: STATEMENT })

    await expect(
      addClaim(deps, { experienceId: EXPERIENCE_ID, kind: 'metric', statement: STATEMENT }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'duplicateClaimStatement' })
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.claims).toHaveLength(1)
  })

  it('returns an Err for a blank statement or an unknown kind', async () => {
    const { deps } = setup()

    expect(
      (await addClaim(deps, { experienceId: EXPERIENCE_ID, kind: 'metric', statement: '  ' })).ok,
    ).toBe(false)
    const unknownKind = await addClaim(deps, {
      experienceId: EXPERIENCE_ID,
      // A kind outside the closed set can only reach this use case from raw input.
      kind: 'vibe' as 'metric',
      statement: STATEMENT,
    })
    expect(unknownKind.ok).toBe(false)
  })
})
