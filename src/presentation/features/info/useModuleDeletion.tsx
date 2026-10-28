/**
 * @file useModuleDeletion
 * @description Confirms deleting a custom module. The dialog names the entries
 * that go with it and the resume sections that will start reporting a missing
 * module; both facts are read before the dialog opens.
 *
 * Responsibilities:
 * - Load the referencing sections for the chosen module
 * - Hold the dialog state and its refusal
 * - Run the delete use case with the confirmed cascade
 *
 * Constraints:
 * - The entry count comes from the store's current library, so deleting a
 *   module after an external write still reports what the reader is looking at.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntryReference } from '../../../domain/info/ports/InfoEntryReferenceQuery'
import { describeError } from '../../app/errorMessages'
import type { ReadableError } from '../../app/errorMessages'
import { useServices } from '../../app/ApplicationServicesProvider'
import { showToast } from '../../app/stores/toastStore'
import { ModuleDeleteDialog } from './ModuleDeleteDialog'
import { useInfoStore } from './stores/infoStore'

export interface ModuleDeletion {
  readonly request: (module: CustomModuleDefinition) => void
  readonly dialog: ReactNode
}

/** @param onDeleted runs after the module and its entries are gone */
export function useModuleDeletion(onDeleted: () => void): ModuleDeletion {
  const service = useServices().info
  const entries = useInfoStore((state) => state.entries)
  const [target, setTarget] = useState<CustomModuleDefinition | null>(null)
  const [references, setReferences] = useState<readonly InfoEntryReference[]>([])
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReadableError | null>(null)

  const entryCount =
    target === null
      ? 0
      : entries.filter((entry) => entry.customModuleId === target.id).length

  const request = (module: CustomModuleDefinition): void => {
    setTarget(module)
    setReferences([])
    setReferenceLoading(true)
    setError(null)
    void service.listModuleReferences(module.id).then(
      (found) => {
        setReferences(found)
        setReferenceLoading(false)
      },
      (thrown: unknown) => {
        setError(describeError(thrown))
        setReferenceLoading(false)
      },
    )
  }

  const close = (): void => {
    if (busy) return
    setTarget(null)
    setError(null)
  }

  const confirm = async (): Promise<void> => {
    const module = target
    if (module === null) return
    setBusy(true)
    setError(null)
    try {
      // The reader has seen the cascade in the dialog, so the confirmation
      // flag can be sent; the use case still owns the deletion itself.
      await useInfoStore.getState().deleteCustomModule(module.id, entryCount > 0)
      setTarget(null)
      showToast('success', `已删除模块「${module.name}」`)
      onDeleted()
    } catch (thrown) {
      setError(describeError(thrown))
      // Counts may have moved under the dialog; refresh so a retry shows truth.
      void useInfoStore.getState().refresh()
    } finally {
      setBusy(false)
    }
  }

  return {
    request,
    dialog:
      target === null ? null : (
        <ModuleDeleteDialog
          module={target}
          entryCount={entryCount}
          references={references}
          referenceLoading={referenceLoading}
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
