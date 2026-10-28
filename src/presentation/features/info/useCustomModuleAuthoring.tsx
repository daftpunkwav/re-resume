/**
 * @file useCustomModuleAuthoring
 * @description Owns the create/edit dialog of a custom module: which definition
 * is being authored, the use cases the dialog calls and what happens after a
 * save. Deleting the module is a separate flow so the two confirmations never
 * stack: asking for deletion closes this dialog first.
 *
 * Responsibilities:
 * - Open the dialog for a new or existing definition
 * - Call the create and update use cases through the store
 * - Report both outcomes and select a newly created module
 *
 * Constraints:
 * - The dialog carries a stable key per request, so opening the create form
 *   again after closing it starts from an empty form without remounting on a
 *   re-render.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import { showToast } from '../../app/stores/toastStore'
import { CustomModuleDialog } from './CustomModuleDialog'
import type { CustomModuleNewField } from './CustomModuleDialog'
import { useInfoStore } from './stores/infoStore'

type AuthoringRequest =
  | { readonly mode: 'create'; readonly key: string }
  | { readonly mode: 'edit'; readonly module: CustomModuleDefinition }

export interface CustomModuleAuthoring {
  readonly openCreate: () => void
  readonly openEdit: (module: CustomModuleDefinition) => void
  readonly dialog: ReactNode
}

/**
 * @param onCreated selects the module the create use case returned
 * @param onRequestDelete runs after this dialog closed; the panel opens the
 *   module's delete confirmation there
 */
export function useCustomModuleAuthoring(
  onCreated: (module: CustomModuleDefinition) => void,
  onRequestDelete: (module: CustomModuleDefinition) => void,
): CustomModuleAuthoring {
  const entries = useInfoStore((state) => state.entries)
  const customModules = useInfoStore((state) => state.customModules)
  const [request, setRequest] = useState<AuthoringRequest | null>(null)
  const [createCount, setCreateCount] = useState(0)

  const openCreate = (): void => {
    setCreateCount((count) => count + 1)
    setRequest({ mode: 'create', key: `create-${String(createCount + 1)}` })
  }
  const openEdit = (module: CustomModuleDefinition): void =>
    setRequest({ mode: 'edit', module })

  const handleSaved = (module: CustomModuleDefinition, created: boolean): void => {
    setRequest(null)
    if (created) {
      showToast('success', `已创建模块「${module.name}」`)
      onCreated(module)
      return
    }
    showToast('success', '已保存模块设置')
  }

  const dialogModule = request === null || request.mode === 'create' ? null : request.module
  const dialogKey = request === null ? 'none' : request.mode === 'create' ? request.key : request.module.id

  return {
    openCreate,
    openEdit,
    dialog:
      request === null ? null : (
        <CustomModuleDialog
          key={dialogKey}
          module={dialogModule}
          entriesOfModule={
            dialogModule === null
              ? []
              : entries.filter((entry) => entry.customModuleId === dialogModule.id)
          }
          existingModules={customModules}
          onClose={() => setRequest(null)}
          onCreate={async (input: {
            readonly name: string
            readonly fields: readonly CustomModuleNewField[]
          }) => {
            const output = await useInfoStore
              .getState()
              .createCustomModule({ name: input.name, fields: [...input.fields] })
            return output.module
          }}
          onUpdate={async (input) => {
            const output = await useInfoStore.getState().updateCustomModule(input)
            return { module: output.module }
          }}
          onRequestDelete={(module) => {
            setRequest(null)
            onRequestDelete(module)
          }}
          onSaved={(module) => handleSaved(module, request.mode === 'create')}
        />
      ),
  }
}
