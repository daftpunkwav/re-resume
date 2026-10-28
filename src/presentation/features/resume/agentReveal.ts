/**
 * @file agentReveal
 * @description Follows the assistant into the resume studio: when a turn writes
 * a resume, this module reloads that document, works out which sections the new
 * revision changed, and asks the canvas to scroll to and flash them.
 *
 * Responsibilities:
 * - Diff two document states into the section identifiers a reader can point at
 * - Run the reveal request the workspace integration queued
 * - Fall back to the visible sections when a revision has no comparable
 *   predecessor, so a locate still lands somewhere rather than nowhere
 *
 * Constraints:
 * - The diff is pure and reads document states only; it never loads a document
 *   or measures text.
 * - The request is consumed once, after the reload. A request that arrives while
 *   the panel is closed waits in the store and runs when the panel mounts.
 */

import { useEffect } from 'react'
import type { ResumeDocumentState } from '../../../domain/resume/DocumentState'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { Revision } from '../../../domain/resume/Revision'
import type { ResumeSectionId } from '../../../domain/shared/branded-id'
import type { ResumeRevealRequest } from './resumeStore'
import { useResumeStore } from './resumeStore'

function sameSection(left: ResumeSection, right: ResumeSection): boolean {
  return (
    left.moduleKind === right.moduleKind &&
    left.customModuleId === right.customModuleId &&
    left.displayName === right.displayName &&
    left.visible === right.visible &&
    left.column === right.column &&
    left.sortOrder === right.sortOrder &&
    left.entryIds.length === right.entryIds.length &&
    left.entryIds.every((entryId, index) => entryId === right.entryIds[index])
  )
}

function sameOverride(left: ResumeOverride, right: ResumeOverride): boolean {
  const leftTarget = left.target.kind === 'summary' ? 'summary' : left.target.entryId
  const rightTarget = right.target.kind === 'summary' ? 'summary' : right.target.entryId
  return leftTarget === rightTarget && left.text === right.text
}

function sectionOfEntry(
  sections: readonly ResumeSection[],
  entryId: string,
): ResumeSection | undefined {
  return sections.find((section) => section.entryIds.includes(entryId as never))
}

/**
 * The sections whose rendered content or composition a revision changed:
 * edited/added sections, and the sections an added, removed or rewritten
 * override renders in. A removed section cannot be pointed at, so it is absent.
 */
export function changedSectionIds(
  previous: ResumeDocumentState | null,
  next: ResumeDocumentState,
): readonly ResumeSectionId[] {
  if (previous === null) {
    return next.sections.filter((section) => section.visible).map((section) => section.id)
  }
  const changed = new Set<ResumeSectionId>()
  const before = new Map(previous.sections.map((section) => [section.id, section]))
  for (const section of next.sections) {
    const earlier = before.get(section.id)
    if (earlier === undefined || !sameSection(earlier, section)) changed.add(section.id)
  }
  // A different set of overrides changes the text of the summary or of an
  // entry, which are rendered inside a section rather than as a section.
  const overridesBefore = new Map(previous.overrides.map((override) => [override.id, override]))
  for (const override of next.overrides) {
    const earlier = overridesBefore.get(override.id)
    if (earlier !== undefined && sameOverride(earlier, override)) continue
    if (override.target.kind === 'summary') {
      for (const section of next.sections) {
        if (section.visible) changed.add(section.id)
      }
      continue
    }
    const section = sectionOfEntry(next.sections, override.target.entryId)
    if (section !== undefined) changed.add(section.id)
  }
  for (const override of previous.overrides) {
    if (next.overrides.some((candidate) => candidate.id === override.id)) continue
    if (override.target.kind === 'entry') {
      const section = sectionOfEntry(next.sections, override.target.entryId)
      if (section !== undefined) changed.add(section.id)
    }
  }
  return [...changed]
}

/** The live revision before `target` on the current chain, if it is still stored. */
export function previousRevisionOf(
  revisions: readonly Revision[],
  target: Revision,
): Revision | undefined {
  const live = revisions
    .filter((revision) => revision.supersededAt === null && revision.seq < target.seq)
    .sort((left, right) => right.seq - left.seq)
  return live[0]
}

/** Sections a reveal falls back to when the revision cannot be compared. */
function visibleSectionIds(): readonly ResumeSectionId[] {
  const resume = useResumeStore.getState().resume
  if (resume === null) return []
  return resume.document.sections
    .filter((section) => section.visible)
    .map((section) => section.id)
}

async function applyReveal(request: ResumeRevealRequest): Promise<void> {
  const store = useResumeStore.getState()
  if (store.services === null) return
  const changed = store.selectedId !== request.resumeId
  if (changed) await store.select(request.resumeId)
  else await store.reload(request.resumeId)
  if (useResumeStore.getState().loadStatus !== 'ready') return
  const state = useResumeStore.getState()
  const target =
    request.revisionId === null
      ? undefined
      : state.revisions.find((revision) => revision.id === request.revisionId)
  const previous = target === undefined ? undefined : previousRevisionOf(state.revisions, target)
  const sectionIds =
    target === undefined ? [] : changedSectionIds(previous?.state ?? null, target.state)
  const fallback = sectionIds.length === 0 ? visibleSectionIds() : sectionIds
  if (fallback.length === 0) return
  const first = fallback[0]
  if (first !== undefined) {
    state.selectSection(first)
    state.requestSection(first)
  }
  state.flashAgentSections(fallback)
}

/**
 * Consumes the queued reveal request for the mounted studio. The request is read
 * from the store so one that arrived before the panel opened is still applied.
 */
export function useResumeAgentReveal(): void {
  const request = useResumeStore((state) => state.revealRequest)
  useEffect(() => {
    if (request === null) return
    const consumed = useResumeStore.getState().consumeReveal()
    if (consumed === null) return
    void applyReveal(consumed)
  }, [request])
}
