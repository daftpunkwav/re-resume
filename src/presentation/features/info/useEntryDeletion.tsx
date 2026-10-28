/**
 * @file useEntryDeletion
 * @description The two-step deletion of one information entry. The first
 * confirmation asks; when the entry is still selected by a resume, the use
 * case refuses and the dialog becomes the reference report, with the action
 * renamed to say what the deletion breaks.
 *
 * Responsibilities:
 * - Hold the dialog state and the referencing resumes
 * - Run the delete use case, turning the refusal into the second step
 * - Report the outcome and hand the panel the neighbour to select
 *
 * Constraints:
 * - The referencing resume titles come from the reference read the domain
 *   exposes, never from the refusal's identifiers.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryReference } from '../../../domain/info/ports/InfoEntryReferenceQuery'
import { isDomainError } from '../../../domain/shared/DomainError'
import { describeError } from '../../app/errorMessages'
import type { ReadableError } from '../../app/errorMessages'
import { useServices } from '../../app/ApplicationServicesProvider'
import { showToast } from '../../app/stores/toastStore'
import { EntryDeleteDialog } from './EntryDeleteDialog'
import type { EntryDeletePhase } from './EntryDeleteDialog'
import { useInfoStore } from './stores/infoStore'

export interface EntryDeletion {
  readonly request: (entry: InfoEntry) => void
  readonly dialog: ReactNode
}

/**
 * @param moduleEntries the current module's entries, used to choose the entry
 *   that takes the deleted one's place
 * @param onDeleted runs after the deletion with the neighbour to select
 */
export function useEntryDeletion(
  moduleEntries: readonly InfoEntry[],
  onDeleted: (neighbour: InfoEntry | null) => void,
): EntryDeletion {
  const service = useServices().info
  const [target, setTarget] = useState<InfoEntry | null>(null)
  const [phase, setPhase] = useState<EntryDeletePhase>('confirm')
  const [references, setReferences] = useState<readonly InfoEntryReference[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReadableError | null>(null)

  const request = (entry: InfoEntry): void => {
    setTarget(entry)
    setPhase('confirm')
    setReferences([])
    setError(null)
  }

  const close = (): void => {
    if (busy) return
    setTarget(null)
    setError(null)
  }

  const confirm = async (): Promise<void> => {
    const entry = target
    if (entry === null) return
    const index = moduleEntries.findIndex((candidate) => candidate.id === entry.id)
    const neighbour = moduleEntries[index + 1] ?? moduleEntries[index - 1] ?? null
    setBusy(true)
    setError(null)
    try {
      await useInfoStore.getState().deleteEntry(entry.id, phase === 'referenced')
      setTarget(null)
      showToast('success', `已删除「${entry.title}」`)
      onDeleted(neighbour)
    } catch (thrown) {
      if (isDomainError(thrown) && thrown.code === 'entryReferenced') {
        try {
          const found = await service.listEntryReferences(entry.id)
          setReferences(found)
          setPhase('referenced')
        } catch (readFailure) {
          setError(describeError(readFailure))
        }
      } else {
        setError(describeError(thrown))
      }
    } finally {
      setBusy(false)
    }
  }

  return {
    request,
    dialog:
      target === null ? null : (
        <EntryDeleteDialog
          entry={target}
          phase={phase}
          references={references}
          busy={busy}
          error={error}
          onConfirm={() => {
            void confirm()
          }}
          onClose={close}
        />
      ),
  }
}
