/**
 * @file contextInjection
 * @description Puts an information entry or a resume into the composer as a
 * context chip, the same way a user typing the request would attach it.
 *
 * Responsibilities:
 * - Resolve the chip label from the library the panel already holds
 * - Add the chip to the turn and move the keyboard to the composer
 * - Report the duplicate case instead of silently adding a second chip
 *
 * Constraints:
 * - Presentation only: the chip is the MessageContext the application stores,
 *   so what the composer sends and what is persisted are the same value.
 * - The composer stays the only writer of its text and chips; this module calls
 *   the store action rather than reaching into the component.
 */

import { moduleDescriptor } from '../../../domain/info/InfoModuleKind'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { Resume } from '../../../domain/resume/Resume'
import { showToast } from '../../app/stores/toastStore'
import { useInfoStore } from '../info/stores/infoStore'
import { useConversationStore } from './stores/conversationStore'

/** The label a chip shows: the module's name and the entry title. */
export function entryContextLabel(entry: InfoEntry): string {
  const customModule =
    entry.customModuleId === null
      ? null
      : (useInfoStore
          .getState()
          .customModules.find((module) => module.id === entry.customModuleId) ?? null)
  return `${moduleDescriptor(entry.moduleKind, customModule).label}：${entry.title}`
}

function alreadyAttached(kind: 'entry' | 'resume', refId: string): boolean {
  return useConversationStore
    .getState()
    .composer.contexts.some((chip) => chip.context.kind === kind && chip.context.refId === refId)
}

function announceDuplicate(): void {
  showToast('info', '这条内容已经在本轮上下文里了')
}

/** Adds one library entry to the next turn. */
export function addEntryToConversation(entry: InfoEntry): void {
  if (alreadyAttached('entry', entry.id)) {
    announceDuplicate()
    return
  }
  const store = useConversationStore.getState()
  store.addContext({ kind: 'entry', refId: entry.id }, entryContextLabel(entry))
  store.requestComposerFocus()
  showToast('success', `已将「${entry.title}」加入本轮上下文`)
}

/** Adds the resume the studio is showing to the next turn. */
export function addResumeToConversation(resume: Resume): void {
  if (alreadyAttached('resume', resume.id)) {
    announceDuplicate()
    return
  }
  const store = useConversationStore.getState()
  store.addContext({ kind: 'resume', refId: resume.id }, `简历：${resume.title}`)
  store.requestComposerFocus()
  showToast('success', `已将「${resume.title}」加入本轮上下文`)
}
