/**
 * @file ResumePanelReady
 * @description The ready layout of the resume studio: identity and revision
 * bars, notices, the canvas and the three editing tabs. The panel decides when
 * this layout exists; this component only renders it.
 */

import type { Resume } from '../../../domain/resume/Resume'
import { TabList } from '../../app/components/Tabs'
import { CanvasViewport } from '../../canvas/CanvasViewport'
import { AppearancePanel } from './AppearancePanel'
import { CompositionEditor } from './CompositionEditor'
import { PageSetupPanel } from './PageSetupPanel'
import { resumeStatusLabel } from './resumeFormat'
import { ResumeLifecycle } from './ResumeLifecycle'
import { ResumeNotices } from './ResumeNotices'
import { ResumeToolbar } from './ResumeToolbar'
import type { StudioTab } from './resumeStore'

const TABS = [
  { id: 'composition' as const, label: '组合' },
  { id: 'appearance' as const, label: '外观' },
  { id: 'page' as const, label: '页面' },
]

export function ResumePanelReady({
  resume,
  activeTab,
  onTabChange,
}: {
  readonly resume: Resume
  readonly activeTab: StudioTab
  readonly onTabChange: (tab: StudioTab) => void
}) {
  return (
    <div className="resume-panel" data-frozen={resume.status === 'frozen' ? 'true' : undefined}>
      <ResumeLifecycle />
      <ResumeToolbar />
      <ResumeNotices />
      <div className="studio-canvas">
        <CanvasViewport />
      </div>
      <section className="studio-editors" aria-label="简历编辑">
        <div className="studio-editor-tabs">
          <TabList tabs={TABS} active={activeTab} onChange={onTabChange} label="简历编辑分区" />
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
    </div>
  )
}
