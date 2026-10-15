/**
 * @file proposeTools
 * @description The propose risk level: a drafted wording is written, and no
 * resume can reach it until the user has confirmed it. The gate under test is
 * structural — the draft and the block that would consume it cannot both be
 * valid at the same time.
 */

import { describe, expect, it } from 'vitest'
import { buildProposeVariantTool } from '../../../src/application/generation/tools/proposeVariant'
import { buildAddBlockTool } from '../../../src/application/generation/tools/addBlock'
import { confirmVariant } from '../../../src/application/experience/ConfirmVariant'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { DomainError } from '../../../src/domain/shared/DomainError'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import { addClaim, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { isUnconfirmedDraft } from '../../../src/domain/catalog/Variant'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { ResumeId } from '../../../src/domain/shared/branded-id'
import {
  asAgentRunId,
  asClaimId,
  asExperienceId,
  asRevisionId,
} from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import {
  InMemoryExperienceRepository,
  InMemoryProfileRepository,
} from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID: ResumeId = 'resume-1' as ResumeId
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const RUN_ID = asAgentRunId('run-agent-1')

interface Harness {
  readonly ctx: Parameters<ReturnType<typeof buildAddBlockTool>['execute']>[1]
  readonly resumes: InMemoryResumeRepository
  readonly experiences: InMemoryExperienceRepository
  readonly clock: FixedClock
  readonly ids: SequentialIdGenerator
}

async function newHarness(): Promise<Harness> {
  const clock = new FixedClock(NOW)
  const experiences = new InMemoryExperienceRepository()
  experiences.seed(catalogExperience())
  const resumes = new InMemoryResumeRepository(() => clock.now())
  const blocks: readonly Block[] = []
  const state = { blocks, pageSetup: A4_PAGE_SETUP }
  await resumes.insertWithInitialRevision(
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
  const runs: AgentRunRepository = {
    create: async () => {},
    save: async () => {},
    findById: async () => null,
  }
  return {
    resumes,
    experiences,
    clock,
    ids: new SequentialIdGenerator('variant'),
    ctx: {
      resumes,
      experiences,
      profiles: InMemoryProfileRepository.seeded(NOW),
      runs,
      clock,
      layout: () => {
        throw new Error('The propose path must not lay out a document.')
      },
    },
  }
}

function catalogExperience(): Experience {
  const created = createExperience(
    { id: asExperienceId('exp-1'), kind: 'work', title: '支付平台工程师', organization: 'ACME' },
    NOW,
  )
  return addClaim(
    created,
    { id: asClaimId('clm-ok'), kind: 'responsibility', statement: '重构支付网关', sourceField: null, status: 'confirmed' },
    NOW,
  )
}

async function findVariant(harness: Harness, variantId: string) {
  const experience = await harness.experiences.findById(asExperienceId('exp-1'))
  if (experience === null) throw new Error('the catalog should hold the experience')
  return experience.variants.find((variant) => variant.id === variantId) ?? null
}

async function draftWith(harness: Harness) {
  const tool = buildProposeVariantTool({ ids: harness.ids, runId: RUN_ID })
  const result = await tool.execute(
    { experienceId: 'exp-1', label: '面向业务', content: '把支付成功率提升到 99.99%。', emphasis: null },
    harness.ctx,
  )
  if (result.kind !== 'drafted') throw new Error(`the draft should have been written: ${JSON.stringify(result)}`)
  return result
}

describe('propose tools', () => {
  it('writes an unconfirmed draft that carries the drafting run', async () => {
    const harness = await newHarness()

    const result = await draftWith(harness)

    expect(result.confirmed).toBe(false)
    expect(result.requiresConfirmation).toBe(true)
    expect(result.draftedByRunId).toBe(RUN_ID)
    const stored = await findVariant(harness, result.variantId)
    if (stored === null) throw new Error('the draft should be stored on its experience')
    expect(stored.confirmedAt).toBeNull()
    expect(isUnconfirmedDraft(stored)).toBe(true)
  })

  it('refuses to let a resume reference the draft', async () => {
    const harness = await newHarness()
    const draft = await draftWith(harness)
    const add = buildAddBlockTool({ ids: harness.ids, runId: RUN_ID })

    await expect(
      add.execute(
        { resumeId: RESUME_ID, experienceId: 'exp-1', variantId: draft.variantId, claimIds: ['clm-ok'] },
        harness.ctx,
      ),
    ).rejects.toThrow(DomainError)
    const resume = await harness.resumes.findById(RESUME_ID)
    expect(resume?.blocks).toHaveLength(0)
  })

  it('lets the block through once the user confirms the draft', async () => {
    const harness = await newHarness()
    const draft = await draftWith(harness)
    await confirmVariant(
      { experienceRepo: harness.experiences, clock: harness.clock },
      asExperienceId('exp-1'),
      draft.variantId,
    )
    const add = buildAddBlockTool({ ids: harness.ids, runId: RUN_ID })

    const result = await add.execute(
      { resumeId: RESUME_ID, experienceId: 'exp-1', variantId: draft.variantId, claimIds: ['clm-ok'] },
      harness.ctx,
    )

    expect(result.kind).toBe('added')
    const resume = await harness.resumes.findById(RESUME_ID)
    expect(resume?.blocks).toHaveLength(1)
  })

  it('surfaces a duplicate label as the aggregate refusal it is', async () => {
    const harness = await newHarness()
    await draftWith(harness)
    const tool = buildProposeVariantTool({ ids: harness.ids, runId: RUN_ID })

    // AddVariant lets the aggregate invariant throw; the run loop turns that
    // into a failed tool result rather than ending the run.
    await expect(
      tool.execute({ experienceId: 'exp-1', label: '面向业务', content: '另一段表述。' }, harness.ctx),
    ).rejects.toThrow(DomainError)
    const experience = await harness.experiences.findById(asExperienceId('exp-1'))
    expect(experience?.variants).toHaveLength(1)
  })

  it('refuses arguments the use case itself rejects', async () => {
    const harness = await newHarness()
    const tool = buildProposeVariantTool({ ids: harness.ids, runId: RUN_ID })

    const result = await tool.execute(
      { experienceId: 'exp-1', label: '面向业务', content: '正文', emphasis: '   ' },
      harness.ctx,
    )

    expect(result.kind).toBe('refused')
    const experience = await harness.experiences.findById(asExperienceId('exp-1'))
    expect(experience?.variants).toHaveLength(0)
  })

  it('refuses to draft when the registry carries no run', async () => {
    const harness = await newHarness()
    const tool = buildProposeVariantTool({ ids: harness.ids, runId: null })

    await expect(
      tool.execute({ experienceId: 'exp-1', label: '无来源', content: '不该被写入。' }, harness.ctx),
    ).rejects.toThrow(/provenance/)
    const experience = await harness.experiences.findById(asExperienceId('exp-1'))
    expect(experience?.variants).toHaveLength(0)
  })
})
