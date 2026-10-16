import { describe, expect, it } from 'vitest'
import { detectStaleReferences } from '../../../src/application/resume/DetectStaleReferences'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import { createResume, setDocument } from '../../../src/domain/resume/Resume'
import type { Resume } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { addClaim, addVariant, createExperience, rejectClaim } from '../../../src/domain/catalog/Experience'
import type { Claim } from '../../../src/domain/catalog/Claim'
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
import type { ClaimId, ResumeId } from '../../../src/domain/shared/branded-id'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const EXPERIENCE_ID = asExperienceId('experience-1')
const OTHER_EXPERIENCE_ID = asExperienceId('experience-2')
const VARIANT_ID = asVariantId('variant-1')
const CLAIM_ID = asClaimId('claim-1')

function resumeWith(resumeId: string, blocks: readonly Block[]): Resume {
  const id = asResumeId(resumeId)
  const initialRevisionId = asRevisionId(`${resumeId}-revision-1`)
  return setDocument(
    createResume(
      { id, title: '简历', targetRole: null, pageSetup: A4_PAGE_SETUP, initialRevisionId },
      NOW,
    ),
    { blocks, pageSetup: A4_PAGE_SETUP },
    initialRevisionId,
    NOW,
  )
}

function experienceBlock(id: string, refVersion: number, claimIds: readonly ClaimId[]): Block {
  return {
    id: asBlockId(id),
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      refVersion,
      claimIds,
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function experienceWithClaim() {
  return addClaim(
    addVariant(
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
    ),
    {
      id: CLAIM_ID,
      kind: 'metric',
      statement: '接口可用性 99.99%。',
      sourceField: 'detail.coverage',
      status: 'confirmed',
    },
    NOW,
  )
}

function claimsWithStatus(status: 'confirmed' | 'pending' | 'rejected'): readonly Claim[] {
  const experience = experienceWithClaim()
  if (status === 'confirmed') return experience.claims
  if (status === 'rejected') return rejectClaim(experience, CLAIM_ID, NOW).claims
  return addClaim(
    experience,
    {
      id: asClaimId('claim-2'),
      kind: 'responsibility',
      statement: '负责跨团队协作。',
      sourceField: null,
      status: 'pending',
    },
    NOW,
  ).claims
}

describe('detectStaleReferences', () => {
  it('reports a block whose facts moved on', () => {
    const resume = resumeWith('resume-1', [experienceBlock('block-1', 1, [])])

    const stale = detectStaleReferences([resume], EXPERIENCE_ID, 3, [])

    expect(stale).toEqual([
      {
        resumeId: 'resume-1' as ResumeId,
        blockId: asBlockId('block-1'),
        reasons: [{ kind: 'factChanged', knownFactVersion: 3 }],
      },
    ])
  })

  it('reports nothing when the version matches', () => {
    const resume = resumeWith('resume-1', [experienceBlock('block-1', 3, [])])

    expect(detectStaleReferences([resume], EXPERIENCE_ID, 3, [])).toHaveLength(0)
  })

  it('reports a rejected claim by id', () => {
    const resume = resumeWith('resume-1', [experienceBlock('block-1', 3, [CLAIM_ID])])

    const stale = detectStaleReferences(
      [resume],
      EXPERIENCE_ID,
      3,
      claimsWithStatus('rejected'),
    )

    expect(stale[0]?.reasons).toEqual([{ kind: 'claimRejected', claimId: CLAIM_ID }])
  })

  it('does not treat a pending claim as stale', () => {
    const resume = resumeWith('resume-1', [experienceBlock('block-1', 3, [CLAIM_ID])])

    const stale = detectStaleReferences([resume], EXPERIENCE_ID, 3, claimsWithStatus('pending'))

    expect(stale).toHaveLength(0)
  })

  it('ignores blocks that reference another experience', () => {
    const resume = resumeWith('resume-1', [
      {
        id: asBlockId('block-1'),
        content: {
          type: 'experience',
          experienceId: OTHER_EXPERIENCE_ID,
          variantId: VARIANT_ID,
          refVersion: 1,
          claimIds: [],
        },
        layout: DEFAULT_FLOW_LAYOUT,
        textStyle: null,
      },
    ])

    expect(detectStaleReferences([resume], EXPERIENCE_ID, 9, [])).toHaveLength(0)
  })

  it('ignores a profile block, whose staleness is offered through its own prompt', () => {
    const resume = resumeWith('resume-1', [
      {
        id: asBlockId('block-1'),
        content: {
          type: 'profile',
          displayName: '张三',
          email: null,
          phone: null,
          links: [],
          refVersion: 1,
        },
        layout: DEFAULT_FLOW_LAYOUT,
        textStyle: null,
      },
    ])

    expect(detectStaleReferences([resume], EXPERIENCE_ID, 9, [])).toHaveLength(0)
  })

  it('reports every affected resume in document order', () => {
    const resumes = [
      resumeWith('resume-1', [experienceBlock('block-1', 1, [])]),
      resumeWith('resume-2', [experienceBlock('block-2', 2, [])]),
    ]

    const stale = detectStaleReferences(resumes, EXPERIENCE_ID, 3, [])

    expect(stale.map((entry) => entry.resumeId)).toEqual(['resume-1', 'resume-2'])
  })
})
