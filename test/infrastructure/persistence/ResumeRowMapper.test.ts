import { describe, expect, it } from 'vitest'
import {
  fromDocumentRevisionRow,
  fromResumeSnapshotRow,
  hydrateResume,
  toDocumentRevisionRow,
  toResumeRow,
  toResumeSnapshotRow,
} from '../../../src/infrastructure/persistence/mappers/ResumeRowMapper'
import type {
  DocumentRevisionRow,
  ResumeRow,
  ResumeSnapshotRow,
} from '../../../src/infrastructure/persistence/mappers/ResumeRowMapper'
import { RowMappingError } from '../../../src/infrastructure/persistence/mappers/JsonEnvelope'
import type { Block } from '../../../src/domain/resume/Block'
import type { Revision } from '../../../src/domain/resume/Revision'
import type { ResumeSnapshot } from '../../../src/domain/resume/ResumeSnapshot'
import type { Resume } from '../../../src/domain/resume/Resume'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { parseDateTime, parseIsoDate } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asAssetId,
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asSnapshotId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'

const NOW = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const LATER = parseDateTime('2026-03-02T00:00:00.000Z') as DateTime

const FLOW_ONE = { mode: 'flow', columnSpan: 1 } as const
const ABSOLUTE = {
  mode: 'absolute',
  x: 12,
  y: 24,
  width: 300,
  height: 48,
  zIndex: 2,
  rotation: 0,
} as const

const BLOCKS: readonly Block[] = [
  {
    id: asBlockId('blk-text'),
    content: { type: 'text', text: '自我介绍' },
    layout: FLOW_ONE,
    textStyle: null,
  },
  {
    id: asBlockId('blk-profile'),
    content: {
      type: 'profile',
      displayName: '张三',
      email: 'zhang@example.com',
      phone: null,
      links: [{ label: 'GitHub', url: 'https://github.com/zhang' }],
      refVersion: 3,
    },
    layout: { mode: 'flow', columnSpan: 2 },
    textStyle: { fontFamily: 'Noto Sans SC', fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
  },
  {
    id: asBlockId('blk-experience'),
    content: {
      type: 'experience',
      experienceId: asExperienceId('exp-1'),
      variantId: asVariantId('var-1'),
      refVersion: 2,
      claimIds: [asClaimId('claim-1'), asClaimId('claim-2')],
    },
    layout: ABSOLUTE,
    textStyle: null,
  },
  {
    id: asBlockId('blk-divider'),
    content: { type: 'divider' },
    layout: FLOW_ONE,
    textStyle: null,
  },
  {
    id: asBlockId('blk-graphic'),
    content: { type: 'graphic', assetId: asAssetId('asset-1') },
    layout: ABSOLUTE,
    textStyle: null,
  },
]

const REVISION: Revision = {
  id: asRevisionId('rev-2'),
  resumeId: asResumeId('res-1'),
  seq: 2,
  label: '添加经历',
  origin: 'agent',
  runId: asAgentRunId('run-1'),
  state: { blocks: BLOCKS, pageSetup: A4_PAGE_SETUP },
  supersededAt: null,
  createdAt: LATER,
}

const SNAPSHOT: ResumeSnapshot = {
  id: asSnapshotId('snap-1'),
  resumeId: asResumeId('res-1'),
  seq: 1,
  materializedBlocks: [
    {
      id: asBlockId('blk-text'),
      content: { type: 'text', text: '自我介绍' },
      layout: FLOW_ONE,
      textStyle: null,
      claims: [],
    },
    {
      id: asBlockId('blk-profile'),
      content: {
        type: 'profile',
        displayName: '张三',
        email: 'zhang@example.com',
        phone: null,
        links: [{ label: 'GitHub', url: 'https://github.com/zhang' }],
      },
      layout: FLOW_ONE,
      textStyle: { fontFamily: 'Noto Sans SC', fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
      claims: [],
    },
    {
      id: asBlockId('blk-experience'),
      content: {
        type: 'experience',
        title: '后端工程师',
        organization: '某公司',
        startDate: parseIsoDate('2024-01-01'),
        endDate: null,
        variantContent: '主导服务拆分',
      },
      layout: FLOW_ONE,
      textStyle: null,
      claims: [
        {
          claimId: asClaimId('claim-1'),
          kind: 'metric',
          statement: '线上延迟下降 30%',
          sourceField: 'detail.latency',
        },
      ],
    },
    {
      id: asBlockId('blk-graphic'),
      content: { type: 'graphic', assetId: asAssetId('asset-1') },
      layout: FLOW_ONE,
      textStyle: null,
      claims: [],
    },
  ],
  pageSetup: A4_PAGE_SETUP,
  createdAt: LATER,
}

function revisionRowWith(overrides: Partial<DocumentRevisionRow>): DocumentRevisionRow {
  return { ...toDocumentRevisionRow(REVISION), ...overrides }
}

function snapshotRowWith(overrides: Partial<ResumeSnapshotRow>): ResumeSnapshotRow {
  return { ...toResumeSnapshotRow(SNAPSHOT), ...overrides }
}

function envelopeOf(data: unknown): string {
  return JSON.stringify({ v: 1, data })
}

describe('ResumeRowMapper — revisions', () => {
  it('round-trips a revision carrying every block variant and both layouts', () => {
    expect(fromDocumentRevisionRow(toDocumentRevisionRow(REVISION))).toEqual(REVISION)
  })

  it('re-brands every reference carried inside a stored block', () => {
    const restored = fromDocumentRevisionRow(toDocumentRevisionRow(REVISION))

    const experienceBlock = restored.state.blocks[2]
    const content = experienceBlock?.content
    expect(content?.type).toBe('experience')
    if (content?.type !== 'experience') throw new Error('expected an experience block')
    expect(content.experienceId).toBe(asExperienceId('exp-1'))
    expect(content.variantId).toBe(asVariantId('var-1'))
    expect(content.claimIds).toEqual([asClaimId('claim-1'), asClaimId('claim-2')])
  })

  it('reads a superseded revision as superseded rather than dropping the row', () => {
    const row = revisionRowWith({ superseded_at: NOW })

    expect(fromDocumentRevisionRow(row).supersededAt).toBe(NOW)
  })

  it('rejects a bare JSON array as blocks_json', () => {
    expect(() => fromDocumentRevisionRow(revisionRowWith({ blocks_json: '[]' }))).toThrow(
      /not a JSON envelope object/,
    )
  })

  it('rejects an envelope version this build does not know', () => {
    expect(() =>
      fromDocumentRevisionRow(revisionRowWith({ blocks_json: '{"v":9,"data":[]}' })),
    ).toThrow(/envelope version 9 is not supported/)
  })

  it('rejects a block whose content type is not modelled', () => {
    const blocks = [{ ...toDocumentStateBlock(BLOCKS[0] as Block), content: { type: 'sticker' } }]

    expect(() =>
      fromDocumentRevisionRow(revisionRowWith({ blocks_json: envelopeOf(blocks) })),
    ).toThrow(/is not one of the block content types/)
  })

  it('rejects a layout that is neither flow nor absolute', () => {
    const blocks = [{ ...toDocumentStateBlock(BLOCKS[0] as Block), layout: { mode: 'float' } }]

    expect(() =>
      fromDocumentRevisionRow(revisionRowWith({ blocks_json: envelopeOf(blocks) })),
    ).toThrow(/neither "flow" nor "absolute"/)
  })

  it('rejects a column span outside the two modelled values', () => {
    const blocks = [{ ...toDocumentStateBlock(BLOCKS[0] as Block), layout: { mode: 'flow', columnSpan: 3 } }]

    expect(() =>
      fromDocumentRevisionRow(revisionRowWith({ blocks_json: envelopeOf(blocks) })),
    ).toThrow(/expected 1 or 2/)
  })

  it('rejects a text style that is missing its line height', () => {
    const blocks = [
      {
        ...toDocumentStateBlock(BLOCKS[0] as Block),
        textStyle: { fontFamily: 'Noto Sans SC', fontSize: 12, fontWeight: 400 },
      },
    ]

    expect(() =>
      fromDocumentRevisionRow(revisionRowWith({ blocks_json: envelopeOf(blocks) })),
    ).toThrow(/lineHeight/)
  })

  it('rejects a page setup with a column count it does not model', () => {
    expect(() =>
      fromDocumentRevisionRow(
        revisionRowWith({ page_setup_json: envelopeOf({ ...A4_PAGE_SETUP, columns: 3 }) }),
      ),
    ).toThrow(/expected 1 or 2/)
  })

  it('rejects a change origin outside the closed set', () => {
    expect(() => fromDocumentRevisionRow(revisionRowWith({ origin: 'import' }))).toThrow(
      /document_revision.origin/,
    )
  })

  it('rejects a run id column that is present but not text', () => {
    expect(() => fromDocumentRevisionRow(revisionRowWith({ run_id: 7 as unknown as string }))).toThrow(
      RowMappingError,
    )
  })
})

describe('ResumeRowMapper — snapshots', () => {
  it('round-trips a snapshot with materialized blocks, claims and page setup', () => {
    expect(fromResumeSnapshotRow(toResumeSnapshotRow(SNAPSHOT))).toEqual(SNAPSHOT)
  })

  it('keeps the page setup inside the snapshot rather than borrowing the cursor', () => {
    const payload = JSON.parse(
      toResumeSnapshotRow({ ...SNAPSHOT, pageSetup: { ...A4_PAGE_SETUP, marginLeft: 36 } })
        .materialized_json,
    ) as { v: number; data: { pageSetup: { marginLeft: number } } }

    expect(payload.v).toBe(1)
    expect(payload.data.pageSetup.marginLeft).toBe(36)
  })

  it('rejects a snapshot envelope without a page setup', () => {
    expect(() =>
      fromResumeSnapshotRow(snapshotRowWith({ materialized_json: envelopeOf({ materializedBlocks: [] }) })),
    ).toThrow(/pageSetup/)
  })

  it('rejects a materialized claim whose kind is not modelled', () => {
    const blocks = JSON.parse(
      toResumeSnapshotRow(SNAPSHOT).materialized_json,
    ) as { data: { materializedBlocks: unknown[] } }
    const materialized = structuredClone(blocks.data.materializedBlocks) as Record<string, unknown>[]
    const experienceBlock = materialized[2] as { claims: Record<string, unknown>[] }
    experienceBlock.claims = [{ ...experienceBlock.claims[0], kind: 'opinion' }]

    expect(() =>
      fromResumeSnapshotRow(
        snapshotRowWith({ materialized_json: envelopeOf({ materializedBlocks: materialized }) }),
      ),
    ).toThrow(/is not one of the permitted values/)
  })

  it('rejects a materialized experience whose start date is not a calendar date', () => {
    const blocks = JSON.parse(
      toResumeSnapshotRow(SNAPSHOT).materialized_json,
    ) as { data: { materializedBlocks: unknown[] } }
    const materialized = structuredClone(blocks.data.materializedBlocks) as Record<string, unknown>[]
    const experienceBlock = materialized[2] as { content: Record<string, unknown> }
    experienceBlock.content = { ...experienceBlock.content, startDate: '2024/01/01' }

    expect(() =>
      fromResumeSnapshotRow(
        snapshotRowWith({ materialized_json: envelopeOf({ materializedBlocks: materialized }) }),
      ),
    ).toThrow(/YYYY-MM-DD/)
  })
})

describe('ResumeRowMapper — hydration', () => {
  function resume(overrides: Partial<Resume> = {}): Resume {
    return {
      id: asResumeId('res-1'),
      title: '后端简历',
      targetRole: '后端工程师',
      status: 'draft',
      pageSetup: A4_PAGE_SETUP,
      blocks: BLOCKS,
      currentRevision: asRevisionId('rev-2'),
      snapshots: [SNAPSHOT],
      createdAt: NOW,
      updatedAt: LATER,
      ...overrides,
    }
  }

  it('takes blocks and page setup from the revision the cursor names', () => {
    const row: ResumeRow = toResumeRow(resume())

    const hydrated = hydrateResume(row, REVISION, [SNAPSHOT])

    expect(hydrated.blocks).toEqual(BLOCKS)
    expect(hydrated.pageSetup).toEqual(A4_PAGE_SETUP)
    expect(hydrated.currentRevision).toBe(asRevisionId('rev-2'))
  })

  it('round-trips the pointer row', () => {
    expect(toResumeRow(resume())).toEqual<ResumeRow>({
      id: 'res-1',
      title: '后端简历',
      target_role: '后端工程师',
      status: 'draft',
      current_revision_id: 'rev-2',
      created_at: NOW,
      updated_at: LATER,
    })
  })

  it('rejects a cursor pointing at another resume, since the schema has no foreign key for it', () => {
    const row: ResumeRow = toResumeRow(resume())
    const foreignRevision: Revision = { ...REVISION, resumeId: asResumeId('res-2') }

    expect(() => hydrateResume(row, foreignRevision, [])).toThrow(
      /names a revision belonging to another resume/,
    )
  })

  it('rejects a status outside the closed set', () => {
    const row: ResumeRow = { ...toResumeRow(resume()), status: 'archived' }

    expect(() => hydrateResume(row, REVISION, [])).toThrow(/resume.status/)
  })
})

/** Blocks are branded value objects; JSON storage holds their plain shape. */
function toDocumentStateBlock(block: Block): Record<string, unknown> {
  return JSON.parse(JSON.stringify(block)) as Record<string, unknown>
}
