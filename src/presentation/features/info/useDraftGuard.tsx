/**
 * @file useDraftGuard
 * @description The unsaved-draft guard of the information panel. A navigation
 * request (module switch, entry switch, dock close) is held while the editor
 * has an unsaved draft; the prompt answers save, discard or cancel.
 *
 * Responsibilities:
 * - Intercept a navigation action only while the draft is dirty
 * - Save the draft before continuing, or discard it, or cancel the navigation
 * - Render the three-answer prompt
 *
 * Constraints:
 * - The guard never unmounts the editor: saving happens in the live form, so a
 *   failed save leaves the draft and its field errors in place.
 */

import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { EntryEditorHandle } from './EntryEditor'
import { InfoChoiceDialog } from './InfoChoiceDialog'

export interface DraftGuard {
  /** Runs the action, or asks about the draft first. */
  readonly requestNavigation: (action: () => void) => void
  readonly dialog: ReactNode
}

interface PendingNavigation {
  readonly action: () => void
}

export function useDraftGuard(editorRef: RefObject<EntryEditorHandle | null>): DraftGuard {
  const [pending, setPending] = useState<PendingNavigation | null>(null)
  const [saving, setSaving] = useState(false)

  const requestNavigation = (action: () => void): void => {
    if (editorRef.current?.isDirty() !== true) {
      action()
      return
    }
    setPending({ action })
  }

  const discardAndContinue = (): void => {
    editorRef.current?.discard()
    const action = pending?.action
    setPending(null)
    action?.()
  }

  const saveAndContinue = async (): Promise<void> => {
    setSaving(true)
    const saved = (await editorRef.current?.save()) ?? true
    setSaving(false)
    if (!saved) {
      setPending(null)
      return
    }
    const action = pending?.action
    setPending(null)
    action?.()
  }

  return {
    requestNavigation,
    dialog: (
      <InfoChoiceDialog
        open={pending !== null}
        title="保存这条信息的修改？"
        description="这条信息有未保存的修改。继续操作会丢失这些修改。"
        actions={[
          {
            label: '取消',
            variant: 'ghost',
            onClick: () => setPending(null),
          },
          {
            label: '放弃修改',
            variant: 'secondary',
            onClick: discardAndContinue,
          },
          {
            label: '保存',
            variant: 'primary',
            busy: saving,
            onClick: () => {
              void saveAndContinue()
            },
          },
        ]}
        onClose={() => {
          if (!saving) setPending(null)
        }}
      />
    ),
  }
}
