/**
 * @file resumeFixtures
 * @description Documents a test renders: a resume, the blocks inside it and the
 * materialized shape the layout port is asked for.
 *
 * The layout here is a fixture, not a second implementation: it stacks blocks
 * at a fixed height so the canvas has something to draw. What it deliberately
 * does not do is decide where a line breaks — that belongs to layout() and to
 * its own tests.
 */

import { A4_PAGE_SETUP } from '../../src/domain/resume/PageSetup'
import type { PageSetup } from '../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../src/domain/resume/Layout'
import type { Block } from '../../src/domain/resume/Block'
import { DEFAULT_TEXT_STYLE } from '../../src/domain/resume/TextStyle'
import type { LaidOutBlock, LaidOutPage, LayoutOutput } from '../../src/domain/resume/PageLayout'
import type { Resume } from '../../src/domain/resume/Resume'
import type { MaterializedBlock, MaterializedContent } from '../../src/domain/resume/ResumeSnapshot'
import { parseDateTime } from '../../src/domain/shared/DateTime'
import {
  asBlockId,
  asResumeId,
  asRevisionId,
} from '../../src/domain/shared/branded-id'

const FIXTURE_INSTANT = parseDateTime('2026-01-01T00:00:00.000Z')
if (FIXTURE_INSTANT === null) throw new Error('The fixture timestamp must parse.')

export const NOW = FIXTURE_INSTANT
export const DRAFT_ID = asResumeId('resume-draft')
export const FROZEN_ID = asResumeId('resume-frozen')

const FIXTURE_BLOCK_HEIGHT = 20

export function textBlock(id: string, text: string): Block {
  return {
    id: asBlockId(id),
    content: { type: 'text', text },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}

export function dividerBlock(id: string): Block {
  return { id: asBlockId(id), content: { type: 'divider' }, layout: DEFAULT_FLOW_LAYOUT, textStyle: null }
}

export function absoluteBlock(id: string, x: number, y: number): Block {
  return {
    id: asBlockId(id),
    content: { type: 'text', text: `定位于 ${x},${y}` },
    layout: { mode: 'absolute', x, y, width: 200, height: 40, zIndex: 0, rotation: 0 },
    textStyle: null,
  }
}

export interface ResumeOverrides {
  readonly id?: ReturnType<typeof asResumeId>
  readonly title?: string
  readonly targetRole?: string | null
  readonly status?: Resume['status']
  readonly pageSetup?: PageSetup
  readonly blocks?: readonly Block[]
}

export function makeResume(overrides: ResumeOverrides = {}): Resume {
  return {
    id: overrides.id ?? DRAFT_ID,
    title: overrides.title ?? '后端工程师简历',
    targetRole: overrides.targetRole === undefined ? '后端工程师' : overrides.targetRole,
    status: overrides.status ?? 'draft',
    pageSetup: overrides.pageSetup ?? A4_PAGE_SETUP,
    blocks: overrides.blocks ?? [textBlock('block-one', '第一段正文'), textBlock('block-two', '第二段正文')],
    currentRevision: asRevisionId('revision-2'),
    snapshots: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function materializedOf(block: Block): MaterializedBlock {
  const content: MaterializedContent = block.content.type === 'divider'
    ? { type: 'divider' }
    : { type: 'text', text: block.content.type === 'text' ? block.content.text : '' }
  return { id: block.id, content, layout: block.layout, textStyle: block.textStyle, claims: [] }
}

/** Stacks blocks one fixed height apart; pagination comes from the caller. */
export function layOutFixture(
  blocks: readonly MaterializedBlock[],
  page: PageSetup,
): LayoutOutput {
  const laidOut: LaidOutBlock[] = blocks.map((block, index) => ({
    blockId: block.id,
    pageIndex: 0,
    x: 0,
    y: index * FIXTURE_BLOCK_HEIGHT,
    width: page.pageWidth - page.marginLeft - page.marginRight,
    height: FIXTURE_BLOCK_HEIGHT,
    textStyle: block.textStyle ?? DEFAULT_TEXT_STYLE,
    lines: [{ text: contentText(block.content), x: 0, width: 200 }],
  }))
  return { pages: pagesOf(laidOut), blocks: laidOut, overflows: [] }
}

export function layoutWithPages(blocks: readonly LaidOutBlock[]): LayoutOutput {
  return { pages: pagesOf(blocks), blocks, overflows: [] }
}

function pagesOf(blocks: readonly LaidOutBlock[]): readonly LaidOutPage[] {
  const byPage = new Map<number, typeof blocks[number]['blockId'][]>()
  for (const block of blocks) {
    const existing = byPage.get(block.pageIndex)
    if (existing === undefined) byPage.set(block.pageIndex, [block.blockId])
    else existing.push(block.blockId)
  }
  return [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, blockIds]) => ({ pageIndex, blockIds }))
}

function contentText(content: MaterializedContent): string {
  if (content.type === 'text') return content.text
  if (content.type === 'profile') return content.displayName
  if (content.type === 'experience') return content.title
  return ''
}
