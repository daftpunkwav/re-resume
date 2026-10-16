/**
 * @file ResumeWorkspace
 * @description The resume region of the window: the list of resumes on the
 * left, the selected one on the right. It owns the two things both sides need
 * — which resume is selected, and the list itself — so a creation and a
 * document change both refresh the same read.
 *
 * Constraints:
 * - Creating a resume and selecting it happen here rather than in the list
 *   panel, so one error surface reports both.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { useServices } from '../../app/ApplicationServicesProvider'
import { useNavigation } from '../../app/navigationStore'
import { useOperation } from '../../app/useOperation'
import { useResource } from '../../app/useResource'

import { asResumeId } from '../../../domain/shared/branded-id'

import { ResumeEditorPanel } from './ResumeEditorPanel'
import type { OperationOutcome } from './ResumeEditorPanel'
import { ResumeListPanel } from './ResumeListPanel'
import type { ResumeCreationRequest } from './ResumeListPanel'

import './resume.css'

export function ResumeWorkspace() {
  const { resumes } = useServices()
  const selectedResumeId = useNavigation((state) => state.selectedResumeId)
  const selectResume = useNavigation((state) => state.selectResume)

  const loadList = useCallback(() => resumes.list(), [resumes])
  const list = useResource(loadList, [resumes])
  // The editor reports upwards because it is remounted whenever the selection
  // moves. A notice about copying a resume has to outlive the panel that
  // produced it — the copy selects itself — so it is held here, above the key.
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null)

  // useOperation's run() takes no argument, so the request waits in a ref
  // until the very call that will read it.
  const pendingCreation = useRef<ResumeCreationRequest | null>(null)
  const create = useCallback(async () => {
    const request = pendingCreation.current
    pendingCreation.current = null
    if (request === null) return
    const created = await resumes.create(request)
    selectResume(created)
  }, [resumes, selectResume])
  const creation = useOperation(create, async () => {
    await list.reload()
  })

  const startCreation = (request: ResumeCreationRequest): void => {
    pendingCreation.current = request
    void creation.run()
  }

  // An empty window has no selection, and a selection the list no longer holds
  // would leave the editor reading a resume that is gone.
  useEffect(() => {
    if (list.data === null) return
    const held = list.data.find((resume) => resume.id === selectedResumeId)
    if (held !== undefined) return
    const first = list.data[0]
    selectResume(first === undefined ? null : first.id)
  }, [list.data, selectResume, selectedResumeId])

  return (
    <div className="split">
      <ResumeListPanel
        resumes={list.data ?? []}
        selectedResumeId={selectedResumeId}
        loading={list.loading}
        busy={creation.busy}
        onSelect={selectResume}
        onCreate={startCreation}
      />

      <div>
        {creation.error === null ? null : (
          <Notice
            tone="danger"
            title={creation.error.message}
            actions={
              <Button size="small" variant="ghost" onClick={creation.clearError}>
                知道了
              </Button>
            }
          />
        )}

        {list.error === null ? null : (
          <Notice tone="danger" title="简历列表读取失败">
            <p>{list.error.message}</p>
          </Notice>
        )}

        {outcome === null ? null : (
          <Notice
            tone={outcome.tone}
            title={outcome.title}
            actions={
              <Button size="small" variant="ghost" onClick={() => setOutcome(null)}>
                知道了
              </Button>
            }
          />
        )}

        {selectedResumeId === null ? (
          <EmptyState
            icon="document"
            title="选择一份简历"
            description="从左边选择一份简历，或者新建一份草稿。"
          />
        ) : (
          <ResumeEditorPanel
            // navigationStore holds the selection as a plain string, so the
            // brand is restored here — the same boundary the row mapper uses.
            //
            // The key is what makes the selection authoritative over whatever
            // the panel was holding: without it, confirming a freeze on one
            // resume and then picking another would leave that confirmation
            // open, and confirming it would freeze a document the user never
            // agreed to freeze.
            key={selectedResumeId}
            resumeId={asResumeId(selectedResumeId)}
            onResumeChanged={() => void list.reload()}
            onOutcome={setOutcome}
          />
        )}
      </div>
    </div>
  )
}
