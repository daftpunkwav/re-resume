/**
 * @file ResumePanelStates
 * @description The loading, failed and empty states of the resume studio panel.
 * They are kept out of the panel component so its render path stays the four
 * states plus the ready layout.
 */

import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { CreateResumeDialog } from './ResumeLifecycle'

export function StudioSkeleton() {
  return (
    <div className="studio-skeleton" aria-busy="true" aria-label="正在加载简历创作面板">
      <div className="studio-skeleton-head">
        <span className="studio-skeleton-bar studio-skeleton-title" />
        <span className="studio-skeleton-bar studio-skeleton-actions" />
      </div>
      <span className="studio-skeleton-bar studio-skeleton-toolbar" />
      <div className="studio-skeleton-canvas">
        <span className="studio-skeleton-page" />
      </div>
      <div className="studio-skeleton-tabs">
        <span className="studio-skeleton-bar studio-skeleton-tab" />
        <span className="studio-skeleton-bar studio-skeleton-tab" />
        <span className="studio-skeleton-bar studio-skeleton-tab" />
      </div>
      <div className="studio-skeleton-rows">
        {[0, 1, 2, 3].map((index) => (
          <span className="studio-skeleton-bar studio-skeleton-row" key={index} />
        ))}
      </div>
    </div>
  )
}

export function StudioListErrorNotice({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) {
  return (
    <div className="resume-panel">
      <div className="studio-state">
        <Notice
          tone="danger"
          title="简历列表没有加载出来"
          actions={
            <Button size="small" variant="secondary" onClick={onRetry}>
              重试
            </Button>
          }
        >
          <p>{message}</p>
        </Notice>
      </div>
    </div>
  )
}

export function StudioResumeErrorNotice({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) {
  return (
    <div className="resume-panel">
      <div className="studio-state">
        <Notice
          tone="danger"
          title="简历没有加载出来"
          actions={
            <Button size="small" variant="secondary" onClick={onRetry}>
              重试
            </Button>
          }
        >
          <p>{message}</p>
        </Notice>
      </div>
    </div>
  )
}

export function StudioEmptyState({
  createOpen,
  onCreateOpen,
  onCreateClose,
}: {
  readonly createOpen: boolean
  readonly onCreateOpen: () => void
  readonly onCreateClose: () => void
}) {
  return (
    <div className="resume-panel">
      <div className="studio-state">
        <EmptyState
          icon="pen"
          title="还没有简历"
          description="把信息库中选中的条目组合成一份简历，再调整模板、外观与页面。"
          action={
            <Button variant="primary" icon="plus" onClick={onCreateOpen}>
              新建简历
            </Button>
          }
        />
        <CreateResumeDialog
          key={createOpen ? 'create-open' : 'create-closed'}
          open={createOpen}
          onClose={onCreateClose}
        />
      </div>
    </div>
  )
}
export function StudioMissingResume() {
  return (
    <div className="resume-panel">
      <div className="studio-state">
        <EmptyState
          icon="pen"
          title="选择一份简历"
          description="从列表中选择一份简历开始创作。"
        />
      </div>
    </div>
  )
}
