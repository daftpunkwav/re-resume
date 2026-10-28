/**
 * @file ResumeLifecycle
 * @description The top of the studio: which resume is open, and the actions
 * that create, copy, rename or remove one. The switcher is a popover list
 * because the dock is narrow; the dialogs are the only place a destructive
 * action happens.
 *
 * Constraints:
 * - Creation writes through `createResume`, which records the first revision;
 *   the store selects the new resume when the write settles.
 * - Deleting is destructive and therefore confirms; duplicates are not, because
 *   they leave the source untouched.
 */

import { useState } from 'react'

import type { TemplateId } from '../../../domain/shared/branded-id'
import { listTemplates } from '../../../domain/resume/Template'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { IconButton } from '../../app/components/IconButton'
import { Popover } from '../../app/components/Popover'
import { TextField } from '../../app/components/TextField'
import { showToast } from '../../app/stores/toastStore'
import { ResumeIcon } from './resumeIcons'
import {
  accentHex,
  resumeStatusLabel,
  targetJobText,
  formatUpdatedAt,
} from './resumeFormat'
import { useResumeStore } from './resumeStore'
import { TemplateCard } from './TemplateGallery'

/** The first-run form, shared by the empty state and the header's create action. */
export function CreateResumeDialog({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const createResume = useResumeStore((state) => state.createResume)
  const committing = useResumeStore((state) => state.committing)
  const templates = listTemplates()
  const [title, setTitle] = useState('我的简历')
  const [templateId, setTemplateId] = useState<TemplateId>(
    templates[0]?.id ?? ('classic-single' as TemplateId),
  )
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setError(null)
    const accepted = await createResume({ title, templateId })
    if (accepted) {
      showToast('success', '简历已创建')
      onClose()
    } else {
      setError(useResumeStore.getState().actionError?.message ?? '创建没有完成，请重试。')
    }
  }

  return (
    <Dialog
      open={open}
      title="新建简历"
      description="先起一个名字并挑一套模板；内容随后从信息库中选择。"
      confirmLabel="创建简历"
      busy={committing}
      onConfirm={() => {
        void submit()
      }}
      onClose={onClose}
    >
      <TextField
        label="简历名称"
        value={title}
        maxLength={80}
        autoFocus
        disabled={committing}
        error={error}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="template-grid template-grid-compact" role="radiogroup" aria-label="起始模板">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            selected={template.id === templateId}
            accent={accentHex('ink')}
            disabled={committing}
            onSelect={(next) => setTemplateId(next.id)}
          />
        ))}
      </div>
    </Dialog>
  )
}

/** The resume identity row: switcher, actions and the metadata line. */
export function ResumeLifecycle() {
  const resume = useResumeStore((state) => state.resume)
  const list = useResumeStore((state) => state.list)
  const selectedId = useResumeStore((state) => state.selectedId)
  const committing = useResumeStore((state) => state.committing)
  const select = useResumeStore((state) => state.select)
  const duplicateResume = useResumeStore((state) => state.duplicateResume)
  const renameResume = useResumeStore((state) => state.renameResume)
  const deleteResume = useResumeStore((state) => state.deleteResume)
  const [listOpen, setListOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(resume?.title ?? '')
  const [dialogError, setDialogError] = useState<string | null>(null)

  if (resume === null) return null
  const frozen = resume.status === 'frozen'
  const busy = committing

  const runAndReport = async (
    action: () => Promise<boolean>,
    successMessage: string,
    close: () => void,
  ): Promise<void> => {
    setDialogError(null)
    const accepted = await action()
    if (accepted) {
      close()
      showToast('success', successMessage)
    } else {
      setDialogError(useResumeStore.getState().actionError?.message ?? '操作没有完成，请重试。')
    }
  }

  return (
    <header className="studio-head">
      <div className="studio-switcher-row">
        <div className="popover-anchor studio-switcher">
          <button
            type="button"
            className="studio-resume-button"
            aria-haspopup="dialog"
            aria-expanded={listOpen}
            aria-label={`当前简历：${resume.title}`}
            onClick={() => setListOpen((open) => !open)}
          >
            <span className="studio-resume-title">{resume.title}</span>
            <Badge tone={frozen ? 'info' : 'neutral'}>{resumeStatusLabel(resume.status)}</Badge>
            <span className="studio-chevron" aria-hidden="true">
              ▾
            </span>
          </button>
          <Popover open={listOpen} label="切换简历" align="start" onClose={() => setListOpen(false)}>
            <p className="popover-title">简历</p>
            <ul className="studio-list">
              {list.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={
                      item.id === selectedId ? 'studio-list-item studio-list-item-active' : 'studio-list-item'
                    }
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    onClick={() => {
                      setListOpen(false)
                      void select(item.id)
                    }}
                  >
                    <span className="studio-list-title">
                      {item.title}
                      <Badge tone={item.status === 'frozen' ? 'info' : 'neutral'}>
                        {resumeStatusLabel(item.status)}
                      </Badge>
                    </span>
                    <span className="studio-list-meta">
                      {targetJobText(item)} · {formatUpdatedAt(item.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="small"
              block
              icon="plus"
              onClick={() => {
                setListOpen(false)
                setCreateOpen(true)
              }}
            >
              新建简历
            </Button>
          </Popover>
        </div>

        <div className="studio-head-actions" role="group" aria-label="简历操作">
          <IconButton
            icon="plus"
            label="新建简历"
            size="small"
            disabled={busy}
            onClick={() => setCreateOpen(true)}
          />
          <button
            type="button"
            className="section-action"
            aria-label="复制这份简历"
            title="复制为新草稿"
            disabled={busy}
            onClick={() => {
              void duplicateResume().then((accepted) => {
                if (accepted) showToast('success', '已复制为新的草稿')
                else showToast('danger', useResumeStore.getState().actionError?.message ?? '复制没有完成')
              })
            }}
          >
            <ResumeIcon name="copy" />
          </button>
          <button
            type="button"
            className="section-action"
            aria-label="重命名这份简历"
            title="重命名"
            disabled={busy}
            onClick={() => {
              setRenameValue(resume.title)
              setDialogError(null)
              setRenameOpen(true)
            }}
          >
            <ResumeIcon name="edit" />
          </button>
          <button
            type="button"
            className="section-action section-action-danger"
            aria-label="删除这份简历"
            title="删除"
            disabled={busy}
            onClick={() => {
              setDialogError(null)
              setDeleteOpen(true)
            }}
          >
            <ResumeIcon name="trash" />
          </button>
        </div>
      </div>

      <p className="studio-meta">
        <span>{targetJobText(resume)}</span>
        <span aria-hidden="true">·</span>
        <span>更新于 {formatUpdatedAt(resume.updatedAt)}</span>
        {frozen && resume.snapshots.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>快照 {formatUpdatedAt(resume.snapshots[0]?.createdAt ?? resume.updatedAt)}</span>
          </>
        ) : null}
      </p>

      <CreateResumeDialog
        key={createOpen ? 'create-open' : 'create-closed'}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <Dialog
        open={renameOpen}
        title="重命名简历"
        confirmLabel="保存名称"
        busy={busy}
        onConfirm={() => {
          void runAndReport(
            () => renameResume(renameValue),
            '名称已更新',
            () => setRenameOpen(false),
          )
        }}
        onClose={() => setRenameOpen(false)}
      >
        <TextField
          label="简历名称"
          value={renameValue}
          maxLength={80}
          autoFocus
          disabled={busy}
          error={dialogError}
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </Dialog>

      <Dialog
        open={deleteOpen}
        title="删除这份简历"
        description={`删除「${resume.title}」及其修订历史与快照？信息库中的条目不会被删除。此操作无法撤销。`}
        confirmLabel="删除简历"
        destructive
        busy={busy}
        onConfirm={() => {
          void runAndReport(
            () => deleteResume(),
            '简历已删除',
            () => setDeleteOpen(false),
          )
        }}
        onClose={() => setDeleteOpen(false)}
      />
    </header>
  )
}
