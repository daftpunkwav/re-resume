/**
 * @file ResumeRowMapper
 * @description Row to aggregate mapping for the resume tables: the pointer row,
 * the revision chain and the frozen snapshots. The document state travels as a
 * versioned JSON envelope in `state_json`, and every nested value is rebuilt and
 * validated on read rather than trusted, so a corrupted row fails loudly at the
 * boundary that owns it.
 *
 * Responsibilities:
 * - Serialise the six document parts into their stored JSON shape
 * - Rebuild branded identifiers, enums, timestamps and the five optional values
 * - Hydrate the aggregate from the pointer row plus the revision it names
 * - Report a violated row contract as `RowMappingError`, never repair it
 *
 * Constraints:
 * - The resume row stores no second copy of the document: only the revision does.
 * - `resume.current_revision_id` has no foreign key, so a pointer to a missing or
 *   foreign revision is a storage fault, not a null.
 * - Re-exporting is not allowed to change the envelope version: the payload
 *   version is independent of the DDL version (spec section 8.4).
 */

import {
  asAttachmentId,
  asCanvasBlockId,
  asConversationId,
  asCustomModuleId,
  asInfoEntryId,
  asJobPostingId,
  asLayoutBlockId,
  asResumeId,
  asResumeOverrideId,
  asResumeSectionId,
  asRevisionId,
  asSnapshotId,
  asTemplateId,
} from '../../../../domain/shared/branded-id'
import type {
  AgentRunId,
  CustomModuleId,
  JobPostingId,
} from '../../../../domain/shared/branded-id'
import { parseDateTime } from '../../../../domain/shared/DateTime'
import type { DateTime } from '../../../../domain/shared/DateTime'
import type { AppearanceSettings } from '../../../../domain/resume/AppearanceSettings'
import {
  ACCENT_COLORS,
  FONT_PAIRS,
  HEADING_STYLES,
} from '../../../../domain/resume/AppearanceSettings'
import type { CanvasBlock, CanvasLayout } from '../../../../domain/resume/CanvasLayout'
import type { ResumeDocumentState } from '../../../../domain/resume/DocumentState'
import type { PageSetup } from '../../../../domain/resume/PageSetup'
import { PAPER_SIZES } from '../../../../domain/resume/PageSetup'
import { INFO_MODULE_KINDS } from '../../../../domain/info/InfoModuleKind'
import type { InfoModuleKind } from '../../../../domain/info/InfoModuleKind'
import type { Resume } from '../../../../domain/resume/Resume'
import { assertFrozenHasSnapshot } from '../../../../domain/resume/Resume'
import type {
  MaterializedDocument,
  MaterializedWarning,
  ResumeSnapshot,
} from '../../../../domain/resume/ResumeSnapshot'
import type { MissingReference } from '../../../../domain/resume/MissingReference'
import type { OverrideTarget, ResumeOverride } from '../../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../../domain/resume/ResumeSection'
import type { Revision } from '../../../../domain/resume/Revision'
import type { TargetJob } from '../../../../domain/resume/TargetJob'
import type { TextStyle } from '../../../../domain/resume/TextStyle'
import {
  RowMappingError,
  readJsonEnvelope,
  writeJsonEnvelope,
} from '../../JsonEnvelope'

const RESUME_STATUSES = ['draft', 'frozen'] as const
const CHANGE_ORIGINS = ['user', 'agent'] as const
const CANVAS_BLOCK_KINDS = ['text', 'divider', 'image'] as const
const COLUMN_COUNTS: readonly (1 | 2)[] = [1, 2]
const FLOW_TARGETS: readonly ('auto' | 1 | 2)[] = ['auto', 1, 2]

export interface ResumeRow {
  readonly id: string
  readonly title: string
  readonly target_job_json: string | null
  readonly status: string
  readonly current_revision_id: string
  readonly conversation_id: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface ResumeRevisionRow {
  readonly id: string
  readonly resume_id: string
  readonly seq: number
  readonly label: string
  readonly origin: string
  readonly run_id: string | null
  readonly state_json: string
  readonly superseded_at: string | null
  readonly created_at: string
}

export interface ResumeSnapshotRow {
  readonly id: string
  readonly resume_id: string
  readonly seq: number
  readonly frozen_state_json: string
  readonly materialized_json: string
  readonly created_at: string
}

export function toResumeRow(resume: Resume): ResumeRow {
  return {
    id: resume.id,
    title: resume.title,
    target_job_json:
      resume.targetJob === null ? null : writeJsonEnvelope(serializeTargetJob(resume.targetJob)),
    status: resume.status,
    current_revision_id: resume.currentRevision,
    conversation_id: resume.conversationId,
    created_at: resume.createdAt,
    updated_at: resume.updatedAt,
  }
}

export function fromResumeRow(row: ResumeRow): Pick<
  Resume,
  | 'id'
  | 'title'
  | 'targetJob'
  | 'status'
  | 'currentRevision'
  | 'conversationId'
  | 'createdAt'
  | 'updatedAt'
> {
  return {
    id: asResumeId(requireString(row.id, 'resume.id')),
    title: requireString(row.title, 'resume.title'),
    targetJob: parseTargetJobColumn(row.target_job_json, 'resume.target_job_json'),
    status: requireEnum(row.status, 'resume.status', RESUME_STATUSES),
    currentRevision: asRevisionId(
      requireString(row.current_revision_id, 'resume.current_revision_id'),
    ),
    conversationId: optionalBranded(
      row.conversation_id,
      'resume.conversation_id',
      asConversationId,
    ),
    createdAt: requireTimestamp(row.created_at, 'resume.created_at'),
    updatedAt: requireTimestamp(row.updated_at, 'resume.updated_at'),
  }
}

export function toRevisionRow(revision: Revision): ResumeRevisionRow {
  return {
    id: revision.id,
    resume_id: revision.resumeId,
    seq: revision.seq,
    label: revision.label,
    origin: revision.origin,
    run_id: revision.runId,
    state_json: writeJsonEnvelope(serializeDocumentState(revision.state)),
    superseded_at: revision.supersededAt,
    created_at: revision.createdAt,
  }
}

export function fromRevisionRow(row: ResumeRevisionRow): Revision {
  return {
    id: asRevisionId(requireString(row.id, 'resume_revision.id')),
    resumeId: asResumeId(requireString(row.resume_id, 'resume_revision.resume_id')),
    seq: requireInteger(row.seq, 'resume_revision.seq'),
    label: requireString(row.label, 'resume_revision.label'),
    origin: requireEnum(row.origin, 'resume_revision.origin', CHANGE_ORIGINS),
    runId: optionalBranded(row.run_id, 'resume_revision.run_id', (value) => value as AgentRunId),
    state: parseDocumentStateEnvelope(row.state_json, 'resume_revision.state_json'),
    supersededAt: optionalTimestamp(row.superseded_at, 'resume_revision.superseded_at'),
    createdAt: requireTimestamp(row.created_at, 'resume_revision.created_at'),
  }
}

export function toSnapshotRow(snapshot: ResumeSnapshot): ResumeSnapshotRow {
  return {
    id: snapshot.id,
    resume_id: snapshot.resumeId,
    seq: snapshot.seq,
    frozen_state_json: writeJsonEnvelope(serializeDocumentState(snapshot.frozenState)),
    materialized_json: writeJsonEnvelope(serializeMaterialized(snapshot.materialized)),
    created_at: snapshot.createdAt,
  }
}

export function fromSnapshotRow(row: ResumeSnapshotRow): ResumeSnapshot {
  return {
    id: asSnapshotId(requireString(row.id, 'resume_snapshot.id')),
    resumeId: asResumeId(requireString(row.resume_id, 'resume_snapshot.resume_id')),
    seq: requireInteger(row.seq, 'resume_snapshot.seq'),
    frozenState: parseDocumentStateEnvelope(
      row.frozen_state_json,
      'resume_snapshot.frozen_state_json',
    ),
    materialized: parseMaterializedEnvelope(
      row.materialized_json,
      'resume_snapshot.materialized_json',
    ),
    createdAt: requireTimestamp(row.created_at, 'resume_snapshot.created_at'),
  }
}

/**
 * Rebuilds the aggregate from its pointer row plus the revision the cursor
 * names. The cursor's integrity is a repository contract (no foreign key), so
 * the caller resolves the revision first.
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
  const resume: Resume = {
    ...fromResumeRow(row),
    document: currentRevision.state,
    snapshots,
  }
  assertFrozenHasSnapshot(resume)
  return resume
}

/** The six-part document state, in the shape `state_json` stores. */
export function serializeDocumentState(state: ResumeDocumentState): Record<string, unknown> {
  return {
    sections: state.sections.map(serializeSection),
    overrides: state.overrides.map(serializeOverride),
    templateId: state.templateId,
    appearance: { ...state.appearance },
    pageSetup: { ...state.pageSetup },
    canvas: { freeBlocks: state.canvas.freeBlocks.map(serializeCanvasBlock) },
  }
}

/**
 * Parses a stored document state envelope. Exported because the repository
 * contract tests corrupt one field at a time to prove every violation is
 * reported as a `RowMappingError`.
 */
export function parseDocumentStateEnvelope(raw: unknown, column: string): ResumeDocumentState {
  return parseDocumentState(readJsonEnvelope(raw, column), column)
}

function parseDocumentState(value: unknown, path: string): ResumeDocumentState {
  const state = requireObject(value, path)
  return {
    sections: requireArray(state.sections, `${path}.sections`).map((section, index) =>
      parseSection(section, `${path}.sections[${index}]`),
    ),
    overrides: requireArray(state.overrides, `${path}.overrides`).map((override, index) =>
      parseOverride(override, `${path}.overrides[${index}]`),
    ),
    templateId: asTemplateId(requireString(state.templateId, `${path}.templateId`)),
    appearance: parseAppearance(state.appearance, `${path}.appearance`),
    pageSetup: parsePageSetup(state.pageSetup, `${path}.pageSetup`),
    canvas: parseCanvas(state.canvas, `${path}.canvas`),
  }
}

function serializeSection(section: ResumeSection): Record<string, unknown> {
  return {
    id: section.id,
    moduleKind: section.moduleKind,
    customModuleId: section.customModuleId,
    displayName: section.displayName,
    entryIds: [...section.entryIds],
    visible: section.visible,
    column: section.column,
    sortOrder: section.sortOrder,
  }
}

function parseSection(value: unknown, path: string): ResumeSection {
  const section = requireObject(value, path)
  return {
    id: asResumeSectionId(requireString(section.id, `${path}.id`)),
    moduleKind: requireEnum<InfoModuleKind>(section.moduleKind, `${path}.moduleKind`, INFO_MODULE_KINDS),
    customModuleId: optionalBranded(section.customModuleId, `${path}.customModuleId`, (text) =>
      text as CustomModuleId,
    ),
    displayName: optionalString(section.displayName, `${path}.displayName`),
    entryIds: requireArray(section.entryIds, `${path}.entryIds`).map((entryId, index) =>
      asInfoEntryId(requireString(entryId, `${path}.entryIds[${index}]`)),
    ),
    visible: requireBoolean(section.visible, `${path}.visible`),
    column: requireEnum<1 | 2>(section.column, `${path}.column`, COLUMN_COUNTS),
    sortOrder: requireInteger(section.sortOrder, `${path}.sortOrder`),
  }
}

function serializeOverride(override: ResumeOverride): Record<string, unknown> {
  return {
    id: override.id,
    target:
      override.target.kind === 'summary'
        ? { kind: 'summary' }
        : { kind: 'entry', entryId: override.target.entryId },
    text: override.text,
    origin: override.origin,
    sourceRunId: override.sourceRunId,
    editedByUser: override.editedByUser,
    createdAt: override.createdAt,
    updatedAt: override.updatedAt,
  }
}

function parseOverride(value: unknown, path: string): ResumeOverride {
  const override = requireObject(value, path)
  return {
    id: asResumeOverrideId(requireString(override.id, `${path}.id`)),
    target: parseOverrideTarget(override.target, `${path}.target`),
    text: requireString(override.text, `${path}.text`),
    origin: requireEnum(override.origin, `${path}.origin`, CHANGE_ORIGINS),
    sourceRunId: optionalBranded(override.sourceRunId, `${path}.sourceRunId`, (text) => text as AgentRunId),
    editedByUser: requireBoolean(override.editedByUser, `${path}.editedByUser`),
    createdAt: requireTimestamp(override.createdAt, `${path}.createdAt`),
    updatedAt: requireTimestamp(override.updatedAt, `${path}.updatedAt`),
  }
}

function parseOverrideTarget(value: unknown, path: string): OverrideTarget {
  const target = requireObject(value, path)
  const kind = requireEnum(target.kind, `${path}.kind`, ['summary', 'entry'] as const)
  if (kind === 'summary') return { kind: 'summary' }
  return {
    kind: 'entry',
    entryId: asInfoEntryId(requireString(target.entryId, `${path}.entryId`)),
  }
}

function serializeCanvasBlock(block: CanvasBlock): Record<string, unknown> {
  return {
    id: block.id,
    kind: block.kind,
    pageIndex: block.pageIndex,
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
    zIndex: block.zIndex,
    text: block.text,
    textStyle: block.textStyle === null ? null : { ...block.textStyle },
    attachmentId: block.attachmentId,
  }
}

function parseCanvasBlock(value: unknown, path: string): CanvasBlock {
  const block = requireObject(value, path)
  return {
    id: asCanvasBlockId(requireString(block.id, `${path}.id`)),
    kind: requireEnum(block.kind, `${path}.kind`, CANVAS_BLOCK_KINDS),
    pageIndex: requireInteger(block.pageIndex, `${path}.pageIndex`),
    x: requireNumber(block.x, `${path}.x`),
    y: requireNumber(block.y, `${path}.y`),
    width: requireNumber(block.width, `${path}.width`),
    height: requireNumber(block.height, `${path}.height`),
    zIndex: requireInteger(block.zIndex, `${path}.zIndex`),
    text: optionalString(block.text, `${path}.text`),
    textStyle: block.textStyle === null || block.textStyle === undefined
      ? null
      : parseTextStyle(block.textStyle, `${path}.textStyle`),
    attachmentId: optionalBranded(block.attachmentId, `${path}.attachmentId`, asAttachmentId),
  }
}

function parseCanvas(value: unknown, path: string): CanvasLayout {
  const canvas = requireObject(value, path)
  return {
    freeBlocks: requireArray(canvas.freeBlocks, `${path}.freeBlocks`).map((block, index) =>
      parseCanvasBlock(block, `${path}.freeBlocks[${index}]`),
    ),
  }
}

function parseAppearance(value: unknown, path: string): AppearanceSettings {
  const appearance = requireObject(value, path)
  return {
    accentColor: requireEnum(appearance.accentColor, `${path}.accentColor`, ACCENT_COLORS),
    fontPairId: requireEnum(appearance.fontPairId, `${path}.fontPairId`, FONT_PAIRS),
    fontScale: requireNumber(appearance.fontScale, `${path}.fontScale`),
    lineHeight: requireNumber(appearance.lineHeight, `${path}.lineHeight`),
    sectionSpacing: requireNumber(appearance.sectionSpacing, `${path}.sectionSpacing`),
    headingStyle: requireEnum(appearance.headingStyle, `${path}.headingStyle`, HEADING_STYLES),
  }
}

function parsePageSetup(value: unknown, path: string): PageSetup {
  const page = requireObject(value, path)
  return {
    paper: requireEnum(page.paper, `${path}.paper`, PAPER_SIZES),
    marginTop: requireNumber(page.marginTop, `${path}.marginTop`),
    marginRight: requireNumber(page.marginRight, `${path}.marginRight`),
    marginBottom: requireNumber(page.marginBottom, `${path}.marginBottom`),
    marginLeft: requireNumber(page.marginLeft, `${path}.marginLeft`),
    columns: requireEnum<1 | 2>(page.columns, `${path}.columns`, COLUMN_COUNTS),
    showPageNumber: requireBoolean(page.showPageNumber, `${path}.showPageNumber`),
  }
}

function parseTextStyle(value: unknown, path: string): TextStyle {
  const style = requireObject(value, path)
  return {
    fontFamily: requireString(style.fontFamily, `${path}.fontFamily`),
    fontSize: requireNumber(style.fontSize, `${path}.fontSize`),
    fontWeight: requireNumber(style.fontWeight, `${path}.fontWeight`),
    lineHeight: requireNumber(style.lineHeight, `${path}.lineHeight`),
  }
}

function serializeTargetJob(target: TargetJob): Record<string, unknown> {
  return {
    title: target.title,
    company: target.company,
    jobPostingId: target.jobPostingId,
  }
}

function parseTargetJobColumn(raw: unknown, column: string): TargetJob | null {
  if (raw === null || raw === undefined) return null
  const payload = requireObject(readJsonEnvelope(raw, column), column)
  return {
    title: optionalString(payload.title, `${column}.title`),
    company: optionalString(payload.company, `${column}.company`),
    jobPostingId: optionalBranded(payload.jobPostingId, `${column}.jobPostingId`, (text) =>
      text as JobPostingId,
    ),
  }
}

function serializeMaterialized(document: MaterializedDocument): Record<string, unknown> {
  return {
    blocks: document.blocks.map((block) => ({
      id: block.id,
      role: block.role,
      paragraphs: block.paragraphs.map((paragraph) => ({
        text: paragraph.text,
        style: { ...paragraph.style },
        bullet: paragraph.bullet,
        spaceBefore: paragraph.spaceBefore,
      })),
      placement:
        block.placement.mode === 'flow'
          ? {
              mode: 'flow',
              columnSpan: block.placement.columnSpan,
              column: block.placement.column,
            }
          : {
              mode: 'absolute',
              x: block.placement.x,
              y: block.placement.y,
              width: block.placement.width,
              height: block.placement.height,
              pageIndex: block.placement.pageIndex,
            },
      keepWithNext: block.keepWithNext,
      keepTogether: block.keepTogether,
      image:
        block.image === null
          ? null
          : {
              attachmentId: block.image.attachmentId,
              width: block.image.width,
              height: block.image.height,
            },
    })),
    missingReferences: document.missingReferences.map((reference) => ({ ...reference })),
    warnings: [...document.warnings],
  }
}

function parseMaterializedEnvelope(raw: unknown, column: string): MaterializedDocument {
  const payload = requireObject(readJsonEnvelope(raw, column), column)
  const warnings = requireArray(payload.warnings, `${column}.warnings`).map((warning, index) =>
    requireEnum<MaterializedWarning>(warning, `${column}.warnings[${index}]`, [
      'entry-missing',
      'image-missing',
      'text-truncated',
    ]),
  )
  const missingReferences = requireArray(
    payload.missingReferences,
    `${column}.missingReferences`,
  ).map((reference, index) => parseMissingReference(reference, `${column}.missingReferences[${index}]`))
  const blocks = requireArray(payload.blocks, `${column}.blocks`).map((block, index) =>
    parseMaterializedBlock(block, `${column}.blocks[${index}]`),
  )
  return { blocks, missingReferences, warnings }
}

function parseMaterializedBlock(
  value: unknown,
  path: string,
): MaterializedDocument['blocks'][number] {
  const block = requireObject(value, path)
  return {
    id: asLayoutBlockId(requireString(block.id, `${path}.id`)),
    role: requireEnum(block.role, `${path}.role`, [
      'sectionHeader',
      'entry',
      'freeText',
      'divider',
      'image',
    ] as const),
    paragraphs: requireArray(block.paragraphs, `${path}.paragraphs`).map((paragraph, index) => {
      const parsed = requireObject(paragraph, `${path}.paragraphs[${index}]`)
      return {
        text: requireString(parsed.text, `${path}.paragraphs[${index}].text`),
        style: parseTextStyle(parsed.style, `${path}.paragraphs[${index}].style`),
        bullet: requireBoolean(parsed.bullet, `${path}.paragraphs[${index}].bullet`),
        spaceBefore: requireNumber(parsed.spaceBefore, `${path}.paragraphs[${index}].spaceBefore`),
      }
    }),
    placement: parsePlacement(block.placement, `${path}.placement`),
    keepWithNext: requireBoolean(block.keepWithNext, `${path}.keepWithNext`),
    keepTogether: requireBoolean(block.keepTogether, `${path}.keepTogether`),
    image: block.image === null || block.image === undefined
      ? null
      : parseImage(block.image, `${path}.image`),
  }
}

function parsePlacement(value: unknown, path: string): MaterializedDocument['blocks'][number]['placement'] {
  const placement = requireObject(value, path)
  const mode = requireEnum(placement.mode, `${path}.mode`, ['flow', 'absolute'] as const)
  if (mode === 'flow') {
    return {
      mode: 'flow',
      columnSpan: requireEnum<1 | 2>(placement.columnSpan, `${path}.columnSpan`, COLUMN_COUNTS),
      column: requireEnum<'auto' | 1 | 2>(placement.column, `${path}.column`, FLOW_TARGETS),
    }
  }
  return {
    mode: 'absolute',
    x: requireNumber(placement.x, `${path}.x`),
    y: requireNumber(placement.y, `${path}.y`),
    width: requireNumber(placement.width, `${path}.width`),
    height: requireNumber(placement.height, `${path}.height`),
    pageIndex: requireInteger(placement.pageIndex, `${path}.pageIndex`),
  }
}

function parseImage(
  value: unknown,
  path: string,
): NonNullable<MaterializedDocument['blocks'][number]['image']> {
  const image = requireObject(value, path)
  return {
    attachmentId: asAttachmentId(requireString(image.attachmentId, `${path}.attachmentId`)),
    width: requireNumber(image.width, `${path}.width`),
    height: requireNumber(image.height, `${path}.height`),
  }
}

function parseMissingReference(value: unknown, path: string): MissingReference {
  const reference = requireObject(value, path)
  const kind = requireEnum(reference.kind, `${path}.kind`, [
    'entry',
    'customModule',
    'override',
    'template',
    'jobPosting',
  ] as const)
  switch (kind) {
    case 'entry':
      return {
        kind,
        entryId: asInfoEntryId(requireString(reference.entryId, `${path}.entryId`)),
        sectionId: asResumeSectionId(requireString(reference.sectionId, `${path}.sectionId`)),
      }
    case 'customModule':
      return {
        kind,
        moduleId: asCustomModuleId(requireString(reference.moduleId, `${path}.moduleId`)),
        sectionId: asResumeSectionId(requireString(reference.sectionId, `${path}.sectionId`)),
      }
    case 'override':
      return {
        kind,
        overrideId: asResumeOverrideId(requireString(reference.overrideId, `${path}.overrideId`)),
        entryId: asInfoEntryId(requireString(reference.entryId, `${path}.entryId`)),
      }
    case 'template':
      return {
        kind,
        templateId: asTemplateId(requireString(reference.templateId, `${path}.templateId`)),
      }
    case 'jobPosting':
      return {
        kind,
        jobPostingId: asJobPostingId(requireString(reference.jobPostingId, `${path}.jobPostingId`)),
      }
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RowMappingError(path, 'expected a JSON object', value)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new RowMappingError(path, 'expected a JSON array', value)
  }
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new RowMappingError(path, 'expected text', value)
  }
  return value
}

function optionalString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, path)
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RowMappingError(path, 'expected a finite number', value)
  }
  return value
}

function requireInteger(value: unknown, path: string): number {
  const numeric = requireNumber(value, path)
  if (!Number.isInteger(numeric)) {
    throw new RowMappingError(path, 'expected an integer', value)
  }
  return numeric
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RowMappingError(path, 'expected true or false', value)
  }
  return value
}

function requireTimestamp(value: unknown, path: string): DateTime {
  const text = requireString(value, path)
  const parsed = parseDateTime(text)
  if (parsed === null) {
    throw new RowMappingError(path, 'expected an ISO 8601 timestamp', text)
  }
  return parsed
}

function optionalTimestamp(value: unknown, path: string): DateTime | null {
  if (value === null || value === undefined) return null
  return requireTimestamp(value, path)
}

function requireEnum<T extends string | number>(
  value: unknown,
  path: string,
  members: readonly T[],
): T {
  if (!(members as readonly unknown[]).includes(value)) {
    throw new RowMappingError(path, 'is not one of the permitted values', value)
  }
  return value as T
}

function optionalBranded<T>(
  value: unknown,
  path: string,
  brand: (text: string) => T,
): T | null {
  if (value === null || value === undefined) return null
  return brand(requireString(value, path))
}
