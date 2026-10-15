/**
 * @file ResumeListPanel
 * @description The resume column: every stored resume, which one is selected,
 * and the one action that adds one. Presentation only — it is handed the list
 * and the create request, and the workspace owns the use case behind them.
 *
 * Constraints:
 * - It must not call the composition root. Loading and creating belong to the
 *   workspace so that one error surface reports both.
 */

import { useState } from 'react'

import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { EmptyState } from '../../app/components/EmptyState'
import { Panel } from '../../app/components/Panel'
import { Spinner } from '../../app/components/Spinner'
import { TextField } from '../../app/components/TextField'
import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeId } from '../../../domain/shared/branded-id'

export interface ResumeCreationRequest {
  readonly title: string
  readonly targetRole: string | null
}

export interface ResumeListPanelProps {
  readonly resumes: readonly Resume[]
  readonly selectedResumeId: string | null
  readonly loading: boolean
  readonly busy: boolean
  readonly onSelect: (resumeId: ResumeId) => void
  readonly onCreate: (request: ResumeCreationRequest) => void
}

export function ResumeListPanel({
  resumes,
  selectedResumeId,
  loading,
  busy,
  onSelect,
  onCreate,
}: ResumeListPanelProps) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)

  const closeDialog = (): void => {
    setCreating(false)
    setTitle('')
    setTargetRole('')
    setTitleError(null)
  }

  const submit = (): void => {
    if (title.trim() === '') {
      setTitleError('标题不能为空。')
      return
    }
    onCreate({ title: title.trim(), targetRole: targetRole.trim() === '' ? null : targetRole.trim() })
    closeDialog()
  }

  return (
    <Panel
      title="简历"
      actions={
        <Button size="small" icon="plus" onClick={() => setCreating(true)} disabled={busy}>
          新建
        </Button>
      }
      flush
    >
      {loading ? (
        <div className="resume-workspace-empty">
          <Spinner label="正在读取简历…" />
        </div>
      ) : resumes.length === 0 ? (
        <div className="resume-workspace-empty">
          <EmptyState
            icon="document"
            title="还没有简历"
            description="新建一份草稿，再从经历库里挑选内容。"
            action={<Button onClick={() => setCreating(true)}>新建简历</Button>}
          />
        </div>
      ) : (
        <div className="resume-list">
          {resumes.map((resume) => {
            const selected = resume.id === selectedResumeId
            return (
              <button
                key={resume.id}
                type="button"
                aria-current={selected ? 'true' : undefined}
                className={[selected ? 'list-row list-row-active' : 'list-row', 'resume-list-row'].join(
                  ' ',
                )}
                onClick={() => onSelect(resume.id)}
              >
                <span className="list-row-body">
                  <span className="list-row-title">{resume.title}</span>
                  <span className="list-row-meta">
                    <Badge tone={resume.status === 'frozen' ? 'info' : 'neutral'}>
                      {resume.status === 'frozen' ? '已定稿' : '草稿'}
                    </Badge>
                    <span className="resume-list-target">
                      {resume.targetRole ?? '未设置目标岗位'}
                    </span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <Dialog
        open={creating}
        title="新建简历"
        description="新简历以空白文档和 A4 页面设置开始，之后的每一步都可以撤销。"
        confirmLabel="创建"
        busy={busy}
        onConfirm={submit}
        onClose={closeDialog}
      >
        <TextField
          label="标题"
          value={title}
          error={titleError}
          onChange={(event) => {
            setTitle(event.target.value)
            setTitleError(null)
          }}
        />
        <TextField
          label="目标岗位"
          value={targetRole}
          hint="可以留空，之后再补。"
          onChange={(event) => setTargetRole(event.target.value)}
        />
      </Dialog>
    </Panel>
  )
}
