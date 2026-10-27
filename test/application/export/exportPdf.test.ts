/**
 * @file exportPdf.test
 * @description The PDF export use case against in-memory repositories: which
 * representation each resume status exports, and how claim status gates a
 * draft. The exporter is a double that records what it was handed — the
 * renderer that consumes those bytes is covered by its own test.
 */

import { describe, expect, it } from 'vitest'
import { commitDocumentChange } from '../../../src/application/resume/CommitDocumentChange'
import { freezeResume } from '../../../src/application/resume/FreezeResume'
import { exportPdf } from '../../../src/application/export/ExportPdf'
import type { ExportedPdf } from '../../../src/application/export/ExportPdf'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import type { LayoutOutput } from '../../../src/domain/resume/PageLayout'
import type { PageSetup } from '../../../src/domain/resume/PageSetup'
import type { MaterializedBlock } from '../../../src/domain/resume/ResumeSnapshot'
import { createResume } from '../../../src/domain/resume/Resume'
import type { Block } from '../../../src/domain/resume/Block'
import { describeChange } from '../../../src/domain/resume/DocumentChange'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import type { ExperienceRepository } from '../../../src/domain/catalog/ports/ExperienceRepository'
import type { ClaimStatus } from '../../../src/domain/catalog/ClaimStatus'
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
import type { ClaimId } from '../../../src/domain/shared/branded-id'
import type { PdfExportInput, ResumePdfExporter } from '../../../src/domain/resume/ports/ResumePdfExporter'
import { DriftingExperienceRepository } from '../../support/driftingExperienceRepository'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { InMemoryExperienceRepository } from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository, initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('resume-1')
const INITIAL_REVISION_ID = asRevisionId('revision-initial')
const EXPERIENCE_ID = asExperienceId('experience-1')
const VARIANT_ID = asVariantId('variant-1')
const CITED_CLAIM_ID = asClaimId('claim-cited')

const BYTES = new Uint8Array([1, 2, 3])

/** Records what the use case handed over and returns fixed bytes. */
class RecordingExporter implements ResumePdfExporter {
  lastInput: PdfExportInput | null = null

  async render(input: PdfExportInput): Promise<Uint8Array> {
    this.lastInput = input
    return BYTES
  }
}

/** A layout stand-in: the shape is real, the geometry is not — placement is
 *  the renderer test's concern, routing is this test's. */
function layoutEcho(
  blocks: readonly MaterializedBlock[],
  _page: PageSetup,
): LayoutOutput {
  return {
    pages: [{ pageIndex: 0, blockIds: blocks.map((block) => block.id) }],
    blocks: [],
    overflows: [],
  }
}

function experienceWithClaim(status: ClaimStatus): Experience {
  const withVariant = addVariant(
    createExperience(
      { id: EXPERIENCE_ID, kind: 'work', title: '后端工程师', organization: '某公司' },
      NOW,
    ),
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
    withVariant,
    {
      id: CITED_CLAIM_ID,
      kind: 'metric',
      statement: '接口可用性 99.99%。',
      sourceField: 'detail.coverage',
      status,
    },
    NOW,
  )
}

function textBlock(id: string, text: string): Block {
  return {
    id: asBlockId(id),
    content: { type: 'text', text },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

function experienceBlock(id: string, claimIds: readonly ClaimId[]): Block {
  return {
    id: asBlockId(id),
    content: {
      type: 'experience',
      experienceId: EXPERIENCE_ID,
      variantId: VARIANT_ID,
      refVersion: 1,
      claimIds,
    },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

async function seededDraftRepo(
  experienceRepo: ExperienceRepository,
  blocks: readonly Block[],
): Promise<InMemoryResumeRepository> {
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
    initialRevision(RESUME_ID, INITIAL_REVISION_ID, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
  await commitDocumentChange(
    repo,
    experienceRepo,
    RESUME_ID,
    describeChange({ label: '填写内容', origin: 'user', runId: null }, () => ({
      blocks: [...blocks],
      pageSetup: A4_PAGE_SETUP,
    })),
  )
  return repo
}

describe('exportPdf', () => {
  it('exports a draft from its current materialized blocks', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experienceWithClaim('confirmed'))
    const repo = await seededDraftRepo(experienceRepo, [
      textBlock('block-0', '三段式后端开发。'),
      experienceBlock('block-1', [CITED_CLAIM_ID]),
    ])
    const exporter = new RecordingExporter()

    const exported: ExportedPdf = await exportPdf(
      repo,
      experienceRepo,
      layoutEcho,
      exporter,
      RESUME_ID,
    )

    expect(exported.bytes).toBe(BYTES)
    expect(exported.pendingClaimBlocks).toEqual([])
    const blocks = exporter.lastInput?.blocks ?? []
    expect(blocks.map((block) => block.id)).toEqual([asBlockId('block-0'), asBlockId('block-1')])
    expect(blocks[1]?.content).toMatchObject({
      type: 'experience',
      title: '后端工程师',
      variantContent: '负责服务治理。',
    })
    expect(exporter.lastInput?.page).toEqual(A4_PAGE_SETUP)
  })

  it('refuses a draft that still cites a rejected claim, naming the blocks', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    // Committed while the claim was acceptable, rejected afterwards — the only
    // way a live draft can carry a rejected citation.
    experienceRepo.seed(experienceWithClaim('pending'))
    const repo = await seededDraftRepo(experienceRepo, [experienceBlock('block-1', [CITED_CLAIM_ID])])
    experienceRepo.seed(experienceWithClaim('rejected'))
    const exporter = new RecordingExporter()

    await expect(
      exportPdf(repo, experienceRepo, layoutEcho, exporter, RESUME_ID),
    ).rejects.toMatchObject({
      code: 'claimRejected',
      detail: { blockers: ['block-1'] },
    })
    expect(exporter.lastInput).toBeNull()
  })

  it('exports a draft citing a pending claim and reports the citing block', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experienceWithClaim('pending'))
    const repo = await seededDraftRepo(experienceRepo, [
      textBlock('block-0', '三段式后端开发。'),
      experienceBlock('block-1', [CITED_CLAIM_ID]),
    ])
    const exporter = new RecordingExporter()

    const exported = await exportPdf(repo, experienceRepo, layoutEcho, exporter, RESUME_ID)

    expect(exported.bytes).toBe(BYTES)
    expect(exported.pendingClaimBlocks).toEqual([asBlockId('block-1')])
  })

  it('reads the cited experiences once, so a claim rejected afterwards is not dropped', async () => {
    const experienceRepo = new DriftingExperienceRepository(
      experienceWithClaim('confirmed'),
      experienceWithClaim('rejected'),
    )
    const repo = await seededDraftRepo(experienceRepo, [
      experienceBlock('block-1', [CITED_CLAIM_ID]),
    ])
    // From here on the library changes under the export, as a rejection from
    // another run would.
    experienceRepo.armed = true
    const exporter = new RecordingExporter()

    const exported = await exportPdf(repo, experienceRepo, layoutEcho, exporter, RESUME_ID)

    // The statement the gate saw is the statement the export carries.
    expect(exported.pendingClaimBlocks).toEqual([])
    expect(exporter.lastInput?.blocks[0]?.claims).toHaveLength(1)
    expect(experienceRepo.reads).toBe(1)
  })

  it('exports a frozen resume from its snapshot, ignoring later library edits', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experienceWithClaim('confirmed'))
    const repo = await seededDraftRepo(experienceRepo, [experienceBlock('block-1', [CITED_CLAIM_ID])])
    await freezeResume(
      repo,
      experienceRepo,
      new SequentialIdGenerator('snapshot'),
      new FixedClock(),
      RESUME_ID,
    )
    // The library moves on; the snapshot must not.
    experienceRepo.seed(
      addVariant(
        experienceWithClaim('confirmed'),
        {
          id: asVariantId('variant-2'),
          label: '业务导向',
          content: '完全不同的表述。',
          emphasis: null,
          draftedByRunId: null,
          confirmedAt: NOW,
        },
        NOW,
      ),
    )
    const exporter = new RecordingExporter()

    const exported = await exportPdf(repo, experienceRepo, layoutEcho, exporter, RESUME_ID)

    expect(exported.pendingClaimBlocks).toEqual([])
    const content = exporter.lastInput?.blocks[0]?.content
    expect(content).toMatchObject({ type: 'experience', variantContent: '负责服务治理。' })
  })

  it('refuses a resume that does not exist', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    const repo = new InMemoryResumeRepository(() => NOW)

    await expect(
      exportPdf(repo, experienceRepo, layoutEcho, new RecordingExporter(), RESUME_ID),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })

  it('refuses a draft whose experience was deleted', async () => {
    const experienceRepo = new InMemoryExperienceRepository()
    experienceRepo.seed(experienceWithClaim('confirmed'))
    const repo = await seededDraftRepo(experienceRepo, [experienceBlock('block-1', [])])
    // The block keeps its reference; the experience behind it is gone.
    await experienceRepo.remove(EXPERIENCE_ID)

    await expect(
      exportPdf(repo, experienceRepo, layoutEcho, new RecordingExporter(), RESUME_ID),
    ).rejects.toMatchObject({ code: 'variantNotInExperience' })
  })
})
