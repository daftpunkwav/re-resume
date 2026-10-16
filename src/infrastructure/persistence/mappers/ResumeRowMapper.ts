/**
 * @file ResumeRowMapper
 * @description Row ↔ aggregate mapping for the resume aggregate: the pointer
 * row, the revision chain that doubles as its undo/redo history, and the
 * frozen snapshots. `blocks_json` carries the whole document model, so this
 * file reconstructs every block variant, layout and text style from stored
 * text rather than trusting the shape it finds there.
 *
 * Constraints:
 * - pageSetup and blocks live only in the revision; the resume row must never
 *   grow a second copy, or the two become competing truths.
 * - `resume_snapshot` has no page-setup column, so the snapshot envelope's
 *   payload is `{ materializedBlocks, pageSetup }`. Exporting a frozen resume
 *   needs the paper size and margins of the moment it was frozen, and deriving
 *   them from the current revision would tie an immutable snapshot to a cursor
 *   that another row owns.
 * - Every reference inside a stored block is re-branded on read, so a block
 *   whose content is not one of the five modelled variants is refused rather
 *   than partially hydrated.
 */

import { CLAIM_KINDS } from '../../../domain/catalog/ClaimKind'
import { parseDateTime, parseIsoDate } from '../../../domain/shared/DateTime'
import type { DateTime, IsoDate } from '../../../domain/shared/DateTime'
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
} from '../../../domain/shared/branded-id'
import type { ProfileLink } from '../../../domain/catalog/Profile'
import type { Block, BlockContent } from '../../../domain/resume/Block'
import type { BlockLayout } from '../../../domain/resume/Layout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { TextStyle } from '../../../domain/resume/TextStyle'
import type { Revision } from '../../../domain/resume/Revision'
import type { Resume } from '../../../domain/resume/Resume'
import type {
  MaterializedBlock,
  MaterializedClaim,
  MaterializedContent,
  ResumeSnapshot,
} from '../../../domain/resume/ResumeSnapshot'
import {
  RowMappingError,
  readJsonArrayEnvelope,
  readJsonRecordEnvelope,
  writeJsonEnvelope,
} from './JsonEnvelope'

const BLOCK_CONTENT_TYPES = ['text', 'profile', 'experience', 'divider', 'graphic'] as const
const RESUME_STATUSES = ['draft', 'frozen'] as const
const CHANGE_ORIGINS = ['user', 'agent'] as const

export interface ResumeRow {
  readonly id: string
  readonly title: string
  readonly target_role: string | null
  readonly status: string
  readonly current_revision_id: string
  readonly created_at: string
  readonly updated_at: string
}

export interface DocumentRevisionRow {
  readonly id: string
  readonly resume_id: string
  readonly seq: number
  readonly label: string
  readonly origin: string
  readonly run_id: string | null
  readonly blocks_json: string
  readonly page_setup_json: string
  readonly superseded_at: string | null
  readonly created_at: string
}

export interface ResumeSnapshotRow {
  readonly id: string
  readonly resume_id: string
  readonly seq: number
  readonly materialized_json: string
  readonly created_at: string
}

export function toResumeRow(resume: Resume): ResumeRow {
  return {
    id: resume.id,
    title: resume.title,
    target_role: resume.targetRole,
    status: resume.status,
    current_revision_id: resume.currentRevision,
    created_at: resume.createdAt,
    updated_at: resume.updatedAt,
  }
}

export function toDocumentRevisionRow(revision: Revision): DocumentRevisionRow {
  return {
    id: revision.id,
    resume_id: revision.resumeId,
    seq: revision.seq,
    label: revision.label,
    origin: revision.origin,
    run_id: revision.runId,
    blocks_json: writeJsonEnvelope(revision.state.blocks),
    page_setup_json: writeJsonEnvelope(revision.state.pageSetup),
    superseded_at: revision.supersededAt,
    created_at: revision.createdAt,
  }
}

export function toResumeSnapshotRow(snapshot: ResumeSnapshot): ResumeSnapshotRow {
  return {
    id: snapshot.id,
    resume_id: snapshot.resumeId,
    seq: snapshot.seq,
    materialized_json: writeJsonEnvelope({
      materializedBlocks: snapshot.materializedBlocks,
      pageSetup: snapshot.pageSetup,
    }),
    created_at: snapshot.createdAt,
  }
}

export function fromDocumentRevisionRow(row: DocumentRevisionRow): Revision {
  return {
    id: asRevisionId(requiredText(row.id, 'document_revision.id')),
    resumeId: asResumeId(requiredText(row.resume_id, 'document_revision.resume_id')),
    seq: requiredInteger(row.seq, 'document_revision.seq'),
    label: requiredText(row.label, 'document_revision.label'),
    origin: requiredEnum(row.origin, 'document_revision.origin', CHANGE_ORIGINS),
    runId:
      row.run_id === null ? null : asAgentRunId(requiredText(row.run_id, 'document_revision.run_id')),
    state: {
      blocks: parseBlocks(row.blocks_json, 'document_revision.blocks_json'),
      pageSetup: parsePageSetup(row.page_setup_json, 'document_revision.page_setup_json'),
    },
    supersededAt: nullableTimestamp(row.superseded_at, 'document_revision.superseded_at'),
    createdAt: requiredTimestamp(row.created_at, 'document_revision.created_at'),
  }
}

export function fromResumeSnapshotRow(row: ResumeSnapshotRow): ResumeSnapshot {
  const payload = readJsonRecordEnvelope(row.materialized_json, 'resume_snapshot.materialized_json')
  const blocks = payload.materializedBlocks
  if (!Array.isArray(blocks)) {
    throw new RowMappingError(
      'resume_snapshot.materialized_json.materializedBlocks',
      'expected a JSON array',
      blocks,
    )
  }
  return {
    id: asSnapshotId(requiredText(row.id, 'resume_snapshot.id')),
    resumeId: asResumeId(requiredText(row.resume_id, 'resume_snapshot.resume_id')),
    seq: requiredInteger(row.seq, 'resume_snapshot.seq'),
    materializedBlocks: blocks.map((block, index) =>
      parseMaterializedBlock(block, `materializedBlocks[${index}]`),
    ),
    pageSetup: readPageSetup(payload.pageSetup, 'materialized_json.pageSetup'),
    createdAt: requiredTimestamp(row.created_at, 'resume_snapshot.created_at'),
  }
}

/**
 * Rebuilds the aggregate from its pointer row plus the revision the cursor
 * names. The cursor's integrity is a repository contract rather than a foreign
 * key (see the schema), so the caller must resolve the revision first.
 */
export function hydrateResume(
  row: ResumeRow,
  currentRevision: Revision,
  snapshots: readonly ResumeSnapshot[],
): Resume {
  if (currentRevision.resumeId !== row.id) {
    throw new RowMappingError(
      'resume.current_revision_id',
      'names a revision belonging to another resume',
      row.current_revision_id,
    )
  }
  return {
    id: asResumeId(requiredText(row.id, 'resume.id')),
    title: requiredText(row.title, 'resume.title'),
    targetRole: nullableText(row.target_role, 'resume.target_role'),
    status: requiredEnum(row.status, 'resume.status', RESUME_STATUSES),
    pageSetup: currentRevision.state.pageSetup,
    blocks: currentRevision.state.blocks,
    currentRevision: currentRevision.id,
    snapshots,
    createdAt: requiredTimestamp(row.created_at, 'resume.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'resume.updated_at'),
  }
}

/**
 * ProfileLink[] appears in two shapes: the profile.links_json column carries its
 * own envelope, while the inline copy inside a profile block is already part of
 * a decoded document. Both directions are shared so a link cannot be written
 * one way and read another.
 */
export function parseProfileLinksEnvelope(raw: unknown, column: string): readonly ProfileLink[] {
  return readProfileLinks(readJsonArrayEnvelope(raw, column), column)
}

export function readProfileLinks(value: unknown, column: string): readonly ProfileLink[] {
  return nestedList(value, column).map((entry, index) => {
    const link = requireObject(entry, `${column}[${index}]`)
    return {
      label: requiredText(link.label, `${column}[${index}].label`),
      url: requiredText(link.url, `${column}[${index}].url`),
    }
  })
}

export function serializeProfileLinks(links: readonly ProfileLink[]): string {
  return writeJsonEnvelope(links.map((link) => ({ label: link.label, url: link.url })))
}

function parseBlocks(raw: unknown, column: string): readonly Block[] {
  return readJsonArrayEnvelope(raw, column).map((block, index) =>
    parseBlock(block, `${column}[${index}]`),
  )
}

function parseBlock(raw: unknown, column: string): Block {
  const block = requireObject(raw, column)
  return {
    id: asBlockId(requiredText(block.id, `${column}.id`)),
    content: parseBlockContent(block.content, `${column}.content`),
    layout: parseLayout(block.layout, `${column}.layout`),
    textStyle:
      block.textStyle === null || block.textStyle === undefined
        ? null
        : parseTextStyle(block.textStyle, `${column}.textStyle`),
  }
}

function parseBlockContent(raw: unknown, column: string): BlockContent {
  const content = requireObject(raw, column)
  const type = requiredText(content.type, `${column}.type`)
  switch (type) {
    case 'text':
      return { type, text: requiredText(content.text, `${column}.text`) }
    case 'profile':
      return {
        type,
        displayName: requiredText(content.displayName, `${column}.displayName`),
        email: nullableText(content.email, `${column}.email`),
        phone: nullableText(content.phone, `${column}.phone`),
        links: readProfileLinks(content.links, `${column}.links`),
        refVersion: requiredInteger(content.refVersion, `${column}.refVersion`),
      }
    case 'experience':
      return {
        type,
        experienceId: asExperienceId(requiredText(content.experienceId, `${column}.experienceId`)),
        variantId: asVariantId(requiredText(content.variantId, `${column}.variantId`)),
        refVersion: requiredInteger(content.refVersion, `${column}.refVersion`),
        claimIds: nestedList(content.claimIds, `${column}.claimIds`).map((claimId, index) =>
          asClaimId(requiredText(claimId, `${column}.claimIds[${index}]`)),
        ),
      }
    case 'divider':
      return { type }
    case 'graphic':
      return { type, assetId: asAssetId(requiredText(content.assetId, `${column}.assetId`)) }
    default:
      throw new RowMappingError(
        `${column}.type`,
        `is not one of the block content types (${BLOCK_CONTENT_TYPES.join(', ')})`,
        type,
      )
  }
}

function parseLayout(raw: unknown, column: string): BlockLayout {
  const layout = requireObject(raw, column)
  const mode = requiredText(layout.mode, `${column}.mode`)
  if (mode === 'flow') {
    return { mode, columnSpan: requiredColumnSpan(layout.columnSpan, `${column}.columnSpan`) }
  }
  if (mode === 'absolute') {
    return {
      mode,
      x: requiredNumber(layout.x, `${column}.x`),
      y: requiredNumber(layout.y, `${column}.y`),
      width: requiredNumber(layout.width, `${column}.width`),
      height: requiredNumber(layout.height, `${column}.height`),
      zIndex: requiredNumber(layout.zIndex, `${column}.zIndex`),
      rotation: requiredNumber(layout.rotation, `${column}.rotation`),
    }
  }
  throw new RowMappingError(`${column}.mode`, 'is neither "flow" nor "absolute"', mode)
}

function parseTextStyle(raw: unknown, column: string): TextStyle {
  const style = requireObject(raw, column)
  return {
    fontFamily: requiredText(style.fontFamily, `${column}.fontFamily`),
    fontSize: requiredNumber(style.fontSize, `${column}.fontSize`),
    fontWeight: requiredNumber(style.fontWeight, `${column}.fontWeight`),
    lineHeight: requiredNumber(style.lineHeight, `${column}.lineHeight`),
  }
}

/** A page setup stored in its own column, inside its own envelope. */
function parsePageSetup(raw: unknown, column: string): PageSetup {
  return readPageSetup(readJsonRecordEnvelope(raw, column), column)
}

/** A page setup nested inside an already-decoded document, such as a snapshot. */
function readPageSetup(value: unknown, column: string): PageSetup {
  const page = requireObject(value, column)
  return {
    pageWidth: requiredNumber(page.pageWidth, `${column}.pageWidth`),
    pageHeight: requiredNumber(page.pageHeight, `${column}.pageHeight`),
    columns: requiredColumnSpan(page.columns, `${column}.columns`),
    marginTop: requiredNumber(page.marginTop, `${column}.marginTop`),
    marginRight: requiredNumber(page.marginRight, `${column}.marginRight`),
    marginBottom: requiredNumber(page.marginBottom, `${column}.marginBottom`),
    marginLeft: requiredNumber(page.marginLeft, `${column}.marginLeft`),
  }
}

function parseMaterializedBlock(raw: unknown, column: string): MaterializedBlock {
  const block = requireObject(raw, column)
  return {
    id: asBlockId(requiredText(block.id, `${column}.id`)),
    content: parseMaterializedContent(block.content, `${column}.content`),
    layout: parseLayout(block.layout, `${column}.layout`),
    textStyle:
      block.textStyle === null || block.textStyle === undefined
        ? null
        : parseTextStyle(block.textStyle, `${column}.textStyle`),
    claims: nestedList(block.claims, `${column}.claims`).map((claim, index) =>
      parseMaterializedClaim(claim, `${column}.claims[${index}]`),
    ),
  }
}

function parseMaterializedContent(raw: unknown, column: string): MaterializedContent {
  const content = requireObject(raw, column)
  const type = requiredText(content.type, `${column}.type`)
  switch (type) {
    case 'text':
      return { type, text: requiredText(content.text, `${column}.text`) }
    case 'profile':
      return {
        type,
        displayName: requiredText(content.displayName, `${column}.displayName`),
        email: nullableText(content.email, `${column}.email`),
        phone: nullableText(content.phone, `${column}.phone`),
        links: readProfileLinks(content.links, `${column}.links`),
      }
    case 'experience':
      return {
        type,
        title: requiredText(content.title, `${column}.title`),
        organization: nullableText(content.organization, `${column}.organization`),
        startDate: nullableIsoDate(content.startDate, `${column}.startDate`),
        endDate: nullableIsoDate(content.endDate, `${column}.endDate`),
        variantContent: requiredText(content.variantContent, `${column}.variantContent`),
      }
    case 'divider':
      return { type }
    case 'graphic':
      return { type, assetId: asAssetId(requiredText(content.assetId, `${column}.assetId`)) }
    default:
      throw new RowMappingError(
        `${column}.type`,
        `is not one of the materialized content types (${BLOCK_CONTENT_TYPES.join(', ')})`,
        type,
      )
  }
}

function parseMaterializedClaim(raw: unknown, column: string): MaterializedClaim {
  const claim = requireObject(raw, column)
  return {
    claimId: asClaimId(requiredText(claim.claimId, `${column}.claimId`)),
    kind: requiredEnum(claim.kind, `${column}.kind`, CLAIM_KINDS),
    statement: requiredText(claim.statement, `${column}.statement`),
    sourceField: nullableText(claim.sourceField, `${column}.sourceField`),
  }
}

function requireObject(value: unknown, column: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RowMappingError(column, 'expected a JSON object', value)
  }
  return value as Record<string, unknown>
}

/**
 * A list nested inside an already-decoded document is not itself an envelope;
 * only a column is. An absent list reads as empty, because a block that stores
 * no claim list asserts that it claims nothing.
 */
function nestedList(value: unknown, column: string): readonly unknown[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    throw new RowMappingError(column, 'expected a JSON array', value)
  }
  return value
}

function requiredText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text', value)
  }
  return value
}

function nullableText(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null
  return requiredText(value, column)
}

function requiredNumber(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RowMappingError(column, 'expected a finite number', value)
  }
  return value
}

function requiredInteger(value: unknown, column: string): number {
  const numeric = requiredNumber(value, column)
  if (!Number.isInteger(numeric)) {
    throw new RowMappingError(column, 'expected an integer', value)
  }
  return numeric
}

function requiredColumnSpan(value: unknown, column: string): 1 | 2 {
  if (value !== 1 && value !== 2) {
    throw new RowMappingError(column, 'expected 1 or 2', value)
  }
  return value
}

function requiredTimestamp(value: unknown, column: string): DateTime {
  const raw = requiredText(value, column)
  const parsed = parseDateTime(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected an ISO 8601 timestamp', raw)
  }
  return parsed
}

function nullableTimestamp(value: unknown, column: string): DateTime | null {
  if (value === null || value === undefined) return null
  return requiredTimestamp(value, column)
}

function nullableIsoDate(value: unknown, column: string): IsoDate | null {
  if (value === null || value === undefined) return null
  const raw = requiredText(value, column)
  const parsed = parseIsoDate(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected a YYYY-MM-DD calendar date', raw)
  }
  return parsed
}

function requiredEnum<T extends string>(
  value: unknown,
  column: string,
  members: readonly T[],
): T {
  const raw = requiredText(value, column)
  if (!(members as readonly string[]).includes(raw)) {
    throw new RowMappingError(column, 'is not one of the permitted values', raw)
  }
  return raw as T
}
