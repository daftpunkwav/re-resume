/**
 * @file CompareVersions
 * @description Structured diff between two points of a resume's history, shared
 * by the editor's version list and the agent preview.
 *
 * Responsibilities:
 * - Resolve a selected version and report which blocks were added, removed,
 *   edited or reordered
 * - Label every changed block so a diff row reads without opening the document
 *
 * Constraints:
 * - Versions are selected by branded identifier. Revision seq and snapshot seq
 *   are independent counters, so a bare seq cannot address both.
 * - A block is compared as the four fields it has in either version: id,
 *   content, layout and text style.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { BlockId, RevisionId, SnapshotId } from '../../domain/shared/branded-id'

export type VersionSelector =
  | { readonly kind: 'revision'; readonly id: RevisionId }
  | { readonly kind: 'snapshot'; readonly id: SnapshotId }

export interface VersionDescriptor {
  readonly kind: 'revision' | 'snapshot'
  readonly id: string
  readonly label: string
}

export type BlockChangeKind = 'added' | 'removed' | 'content-changed' | 'reordered'

export interface BlockChange {
  readonly kind: BlockChangeKind
  readonly blockId: BlockId
  readonly label: string
  readonly fromIndex: number | null
  readonly toIndex: number | null
}

export interface VersionDiff {
  readonly from: VersionDescriptor
  readonly to: VersionDescriptor
  readonly pageSetupChanged: boolean
  readonly changes: readonly BlockChange[]
}

export async function compareVersions(
  resumeRepo: ResumeRepository,
  from: VersionSelector,
  to: VersionSelector,
): Promise<VersionDiff> {
  const left = await resolveVersion(resumeRepo, from)
  const right = await resolveVersion(resumeRepo, to)
  const changes: BlockChange[] = []
  left.blocks.forEach((block, index) => {
    const position = indexOfBlock(right.blocks, block.id)
    if (position < 0) {
      changes.push(change('removed', block, labelOf(block), index, null))
      return
    }
    const counterpart = right.blocks[position]
    if (counterpart === undefined || !isSameBlock(block, counterpart)) {
      changes.push(change('content-changed', block, labelOf(counterpart ?? block), index, position))
      return
    }
    if (position !== index) changes.push(change('reordered', block, labelOf(block), index, position))
  })
  right.blocks.forEach((block, index) => {
    if (indexOfBlock(left.blocks, block.id) < 0) {
      changes.push(change('added', block, labelOf(block), null, index))
    }
  })
  return {
    from: left.descriptor,
    to: right.descriptor,
    pageSetupChanged: !isSamePageSetup(left.pageSetup, right.pageSetup),
    changes,
  }
}

function change(
  kind: BlockChangeKind,
  block: ComparableBlock,
  label: string,
  fromIndex: number | null,
  toIndex: number | null,
): BlockChange {
  return { kind, blockId: block.id, label, fromIndex, toIndex }
}

function indexOfBlock(blocks: readonly ComparableBlock[], blockId: BlockId): number {
  return blocks.findIndex((block) => block.id === blockId)
}

/**
 * The shared shape of a live block and a materialized block. Their content
 * types differ, so it is carried as an opaque value and compared structurally.
 */
interface ComparableBlock {
  readonly id: BlockId
  readonly content: unknown
  readonly layout: unknown
  readonly textStyle: unknown
}

interface ResolvedVersion {
  readonly descriptor: VersionDescriptor
  readonly blocks: readonly ComparableBlock[]
  readonly pageSetup: PageSetup
}

async function resolveVersion(
  resumeRepo: ResumeRepository,
  selector: VersionSelector,
): Promise<ResolvedVersion> {
  if (selector.kind === 'revision') {
    const revision = await resumeRepo.readRevision(selector.id)
    if (revision === null) throw missingVersion('revision', selector.id)
    return {
      descriptor: {
        kind: 'revision',
        id: revision.id,
        label: `#${revision.seq} ${revision.label}`,
      },
      blocks: revision.state.blocks,
      pageSetup: revision.state.pageSetup,
    }
  }
  const snapshot = await resumeRepo.findSnapshotById(selector.id)
  if (snapshot === null) throw missingVersion('snapshot', selector.id)
  return {
    descriptor: { kind: 'snapshot', id: snapshot.id, label: `快照 #${snapshot.seq}` },
    blocks: snapshot.materializedBlocks,
    pageSetup: snapshot.pageSetup,
  }
}

function missingVersion(kind: 'revision' | 'snapshot', id: string): DomainError {
  // The closed DomainError code set has no not-found member; this is the code
  // the resume port's own implementations use when a revision cannot be
  // resolved.
  return new DomainError('cursorNotOnLiveChain', `The selected ${kind} does not exist.`, {
    entity: 'resume',
    id: '',
    blockers: [id],
  })
}

function isSameBlock(left: ComparableBlock, right: ComparableBlock): boolean {
  return (
    sameValue(left.content, right.content) &&
    sameValue(left.layout, right.layout) &&
    sameValue(left.textStyle, right.textStyle)
  )
}

function isSamePageSetup(left: PageSetup, right: PageSetup): boolean {
  return (
    left.pageWidth === right.pageWidth &&
    left.pageHeight === right.pageHeight &&
    left.columns === right.columns &&
    left.marginTop === right.marginTop &&
    left.marginRight === right.marginRight &&
    left.marginBottom === right.marginBottom &&
    left.marginLeft === right.marginLeft
  )
}

/**
 * Field-order-independent structural equality. A state written by a document
 * change and one written by an exporter carry the same fields in a different
 * order, and a serialisation comparison would report that as an edit.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object') return false
  if (left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return (
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    )
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  if (keys.length !== Object.keys(rightRecord).length) return false
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      sameValue(leftRecord[key], rightRecord[key]),
  )
}

function labelOf(block: ComparableBlock): string {
  const record = asRecord(block.content)
  const type = typeof record['type'] === 'string' ? record['type'] : 'block'
  const detail = describeContent(record, type)
  return detail === '' ? type : `${type}: ${detail}`
}

function describeContent(record: Record<string, unknown>, type: string): string {
  if (type === 'text') return summarize(readString(record, 'text'))
  if (type === 'profile') return summarize(readString(record, 'displayName'))
  if (type === 'experience') {
    const materializedTitle = readString(record, 'title')
    return materializedTitle ?? summarize(readString(record, 'experienceId'))
  }
  if (type === 'graphic') return summarize(readString(record, 'assetId'))
  return ''
}

const LABEL_LENGTH = 24

function summarize(value: string | null): string {
  if (value === null) return ''
  const flattened = value.replace(/\s+/gu, ' ').trim()
  return flattened.length > LABEL_LENGTH ? `${flattened.slice(0, LABEL_LENGTH)}…` : flattened
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
