/**
 * @file ResumePanel
 * @description The resume studio as the right-hand dock mounts it: the resume
 * list lifecycle, the revision bar, the canvas viewport and the three editing
 * tabs (composition, appearance, page). This file owns the panel's lifecycle
 * and keyboard shortcuts; each region owns its own rendering.
 *
 * Responsibilities:
 * - Bind the studio store to the application services while the panel is open
 * - Choose between the loading, empty, failed and ready states
 * - Route Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z to undo/redo unless the user is typing
 *
 * Constraints:
 * - The panel unmounts when the dock closes (the dock does not hide features),
 *   so every store subscription and window listener is mounted with it.
 * - No document rule lives here: the store calls the use cases and the use cases
 *   validate.
 */

import { useEffect, useState } from 'react'

import { useServices } from '../../app/ApplicationServicesProvider'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { TabList } from '../../app/components/Tabs'
import { isEditableTarget } from '../../app/shortcuts'
import { CanvasViewport } from '../../canvas/CanvasViewport'
import { AppearancePanel } from './AppearancePanel'
import { CompositionEditor } from './CompositionEditor'
import { PageSetupPanel } from './PageSetupPanel'
import { resumeStatusLabel } from './resumeFormat'
import { ResumeLifecycle, CreateResumeDialog } from './ResumeLifecycle'
import { ResumeNotices } from './ResumeNotices'
import { ResumeToolbar } from './ResumeToolbar'
import { useResumeStore } from './resumeStore'
import type { StudioTab } from './resumeStore'
import './resume.css'

const TABS = [
  { id: 'composition' as const, label: '组合' },
  { id: 'appearance' as const, label: '外观' },
  { id: 'page' as const, label: '页面' },
]

function StudioSkeleton() {
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

export function ResumePanel() {
  const services = useServices()
  const list = useResumeStore((state) => state.list)
  const listStatus = useResumeStore((state) => state.listStatus)
  const listError = useResumeStore((state) => state.listError)
  const loadStatus = useResumeStore((state) => state.loadStatus)
  const loadError = useResumeStore((state) => state.loadError)
  const resume = useResumeStore((state) => state.resume)
  const activeTab = useResumeStore((state) => state.activeTab)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const store = useResumeStore.getState()
    store.attach({ resume: services.resume, info: services.info })
    void store.loadInitial()
    return () => {
      useResumeStore.getState().detach()
    }
  }, [services])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || isEditableTarget(event.target)) return
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]') !== null) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'z') return
      const store = useResumeStore.getState()
      if (store.resume === null || store.resume.status === 'frozen') return
      event.preventDefault()
      if (event.shiftKey) void store.redo()
      else void store.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const loadingInitial =
    (listStatus === 'loading' || listStatus === 'idle') && list.length === 0
  const listFailed = listStatus === 'error' && list.length === 0
  const empty = listStatus === 'ready' && list.length === 0
  const loadingResume = resume === null && loadStatus === 'loading' && list.length > 0
  const resumeFailed = resume === null && loadStatus === 'error' && list.length > 0

  if (loadingInitial || loadingResume) return <StudioSkeleton />

  if (resumeFailed) {
    return (
      <div className="resume-panel">
        <div className="studio-state">
          <Notice
            tone="danger"
            title="简历没有加载出来"
            actions={
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  const store = useResumeStore.getState()
                  if (store.selectedId !== null) void store.select(store.selectedId)
                  else void store.loadInitial()
                }}
              >
                重试
              </Button>
            }
          >
            <p>{loadError?.message ?? '请重试。'}</p>
          </Notice>
        </div>
      </div>
    )
  }

  if (listFailed) {
    return (
      <div className="resume-panel">
        <div className="studio-state">
          <Notice
            tone="danger"
            title="简历列表没有加载出来"
            actions={
              <Button
                size="small"
                variant="secondary"
                onClick={() => void useResumeStore.getState().loadInitial()}
              >
                重试
              </Button>
            }
          >
            <p>{listError?.message ?? '请重试。'}</p>
          </Notice>
        </div>
      </div>
    )
  }

  if (empty) {
    return (
      <div className="resume-panel">
        <div className="studio-state">
          <EmptyState
            icon="pen"
            title="还没有简历"
            description="把信息库中选中的条目组合成一份简历，再调整模板、外观与页面。"
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>
                新建简历
              </Button>
            }
          />
          <CreateResumeDialog
            key={createOpen ? 'create-open' : 'create-closed'}
            open={createOpen}
            onClose={() => setCreateOpen(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="resume-panel" data-frozen={resume?.status === 'frozen' ? 'true' : undefined}>
      {resume === null ? (
        <div className="studio-state">
          <EmptyState
            icon="pen"
            title="选择一份简历"
            description="从列表中选择一份简历开始创作。"
          />
        </div>
      ) : (
        <>
          <ResumeLifecycle />
          <ResumeToolbar />
          <ResumeNotices />
          <div className="studio-canvas">
            <CanvasViewport />
          </div>
          <section className="studio-editors" aria-label="简历编辑">
            <div className="studio-editor-tabs">
              <TabList
                tabs={TABS}
                active={activeTab}
                onChange={(tab: StudioTab) => setActiveTab(tab)}
                label="简历编辑分区"
              />
              <span className="studio-editor-state">
                {resumeStatusLabel(resume.status)} · {resume.document.sections.length} 章
              </span>
            </div>
            <div
              className="studio-editor-scroll"
              role="tabpanel"
              id={`tabpanel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
              tabIndex={0}
            >
              {activeTab === 'composition' ? <CompositionEditor key={resume.id} /> : null}
              {activeTab === 'appearance' ? <AppearancePanel key={resume.id} /> : null}
              {activeTab === 'page' ? <PageSetupPanel key={resume.id} /> : null}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
