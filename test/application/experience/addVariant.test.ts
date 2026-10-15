import { describe, expect, it } from 'vitest'
import { addVariant } from '../../../src/application/experience/AddVariant'
import type { AddVariantDeps } from '../../../src/application/experience/AddVariant'
import { createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { asAgentRunId, asExperienceId } from '../../../src/domain/shared/branded-id'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

const NOW: DateTime = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('exp-1')

function workExperience(): Experience {
  return createExperience({ id: EXPERIENCE_ID, kind: 'work', title: '后端工程师' }, NOW)
}

function setup(): { deps: AddVariantDeps; repo: InMemoryExperienceRepository } {
  const repo = new InMemoryExperienceRepository()
  repo.seed(workExperience())
  return {
    repo,
    deps: {
      experienceRepo: repo,
      clock: new FixedClock(NOW),
      ids: new SequentialIdGenerator('var'),
    },
  }
}

describe('addVariant', () => {
  it('confirms a user-authored variant on creation', async () => {
    const { deps, repo } = setup()

    const result = await addVariant(deps, {
      experienceId: EXPERIENCE_ID,
      label: '架构导向',
      content: '负责服务拆分',
    })

    expect(result.ok).toBe(true)
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.confirmedAt).toBe(NOW)
    expect(stored?.variants[0]?.draftedByRunId).toBeNull()
    expect(stored?.variants[0]?.id).toBe('var-1')
  })

  it('leaves an agent draft unconfirmed and keeps the drafting run', async () => {
    const { deps, repo } = setup()

    await addVariant(deps, {
      experienceId: EXPERIENCE_ID,
      label: '业务价值导向',
      content: '把构建时间从 40 分钟降到 6 分钟',
      draftedByRunId: asAgentRunId('run-1'),
    })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.confirmedAt).toBeNull()
    expect(stored?.variants[0]?.draftedByRunId).toBe('run-1')
  })

  it('refuses a label the experience already uses', async () => {
    const { deps, repo } = setup()

    await addVariant(deps, {
      experienceId: EXPERIENCE_ID,
      label: '架构导向',
      content: '第一版',
    })

    await expect(
      addVariant(deps, {
        experienceId: EXPERIENCE_ID,
        label: '架构导向',
        content: '第二版',
      }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'duplicateVariantLabel' })
    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants).toHaveLength(1)
  })

  it('returns an Err for a blank label or a blank body', async () => {
    const { deps, repo } = setup()

    expect((await addVariant(deps, { experienceId: EXPERIENCE_ID, label: '  ', content: '正文' })).ok).toBe(
      false,
    )
    expect(
      (await addVariant(deps, { experienceId: EXPERIENCE_ID, label: '架构导向', content: ' ' })).ok,
    ).toBe(false)
    expect(repo.size).toBe(1)
  })

  it('turns a cleared emphasis into null', async () => {
    const { deps, repo } = setup()

    await addVariant(deps, {
      experienceId: EXPERIENCE_ID,
      label: '架构导向',
      content: '负责服务拆分',
      emphasis: '',
    })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.variants[0]?.emphasis).toBeNull()
  })

  it('bumps factVersion because the variant set changed', async () => {
    const { deps, repo } = setup()

    await addVariant(deps, {
      experienceId: EXPERIENCE_ID,
      label: '架构导向',
      content: '负责服务拆分',
    })

    const stored = await repo.findById(EXPERIENCE_ID)
    expect(stored?.factVersion).toBe(2)
  })
})
