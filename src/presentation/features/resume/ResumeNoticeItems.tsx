/**
 * @file ResumeNoticeItems
 * @description The individual banner items above the canvas. Each item returns
 * null when it has nothing to report, so the notice strip is a fixed ordered
 * list and not a tree of conditions.
 */

import type { MissingReference } from '../../../domain/resume/MissingReference'
import { Button } from '../../app/components/Button'
import { Notice } from '../../app/components/Notice'
import { formatUpdatedAt, missingReferenceText } from './resumeFormat'
import { useResumeStore } from './resumeStore'

function isLocatable(reference: MissingReference): boolean {
  return reference.kind === 'entry' || reference.kind === 'customModule'
}

export function AgentBusyBar() {
  const agentBusy = useResumeStore((state) => state.agentBusy)
  if (!agentBusy) return null
  return (
    <div className="studio-agent-bar" role="status">
      <span className="studio-agent-dot" aria-hidden="true" />
      Agent 正在修改这份简历
    </div>
  )
}

export function LoadErrorNotice() {
  const loadError = useResumeStore((state) => state.loadError)
  const resume = useResumeStore((state) => state.resume)
  const reload = useResumeStore((state) => state.reload)
  const select = useResumeStore((state) => state.select)
  if (loadError === null) return null
  return (
    <Notice
      tone="danger"
      title="简历没有加载出来"
      actions={
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            if (resume === null) void reload()
            else void select(resume.id)
          }}
        >
          重试
        </Button>
      }
    >
      <p>{loadError.message}</p>
    </Notice>
  )
}

export function ActionErrorNotice() {
  const actionError = useResumeStore((state) => state.actionError)
  const missingCount = useResumeStore((state) => state.materialized?.missingReferences.length ?? 0)
  const clearActionError = useResumeStore((state) => state.clearActionError)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  if (actionError === null) return null
  const locate = missingCount > 0
  return (
    <Notice
      tone="danger"
      title="这次操作没有完成"
      actions={
        locate ? (
          <Button
            size="small"
            variant="secondary"
            onClick={() => {
              clearActionError()
              setActiveTab('composition')
            }}
          >
            去组合里处理
          </Button>
        ) : (
          <Button size="small" variant="secondary" onClick={clearActionError}>
            知道了
          </Button>
        )
      }
    >
      <p>{actionError.message}</p>
    </Notice>
  )
}

export function MissingReferencesNotice() {
  const missing = useResumeStore((state) => state.materialized?.missingReferences ?? [])
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const selectSection = useResumeStore((state) => state.selectSection)
  const requestSection = useResumeStore((state) => state.requestSection)
  if (missing.length === 0) return null
  const visible = missing.slice(0, 4)
  return (
    <Notice
      tone="warning"
      title={`${missing.length.toString()} 处引用已失效`}
      actions={
        <Button size="small" variant="secondary" onClick={() => setActiveTab('composition')}>
          去组合里处理
        </Button>
      }
    >
      <ul className="studio-reference-list">
        {visible.map((reference, index) => (
          <li key={`${reference.kind}-${index.toString()}`}>
            <span>{missingReferenceText(reference)}</span>
            {isLocatable(reference) && 'sectionId' in reference ? (
              <Button
                variant="ghost"
                size="small"
                onClick={() => {
                  setActiveTab('composition')
                  selectSection(reference.sectionId)
                  requestSection(reference.sectionId)
                }}
              >
                定位
              </Button>
            ) : null}
          </li>
        ))}
        {missing.length > visible.length ? (
          <li className="studio-reference-more">还有 {missing.length - visible.length} 处</li>
        ) : null}
      </ul>
    </Notice>
  )
}

export function EntryUpdatesNotice() {
  const entryUpdates = useResumeStore((state) => state.entryUpdates)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  if (entryUpdates.size === 0) return null
  return (
    <Notice
      tone="info"
      title="信息库中有条目已更新"
      actions={
        <Button size="small" variant="secondary" onClick={() => setActiveTab('composition')}>
          去组合里查看
        </Button>
      }
    >
      <p>
        这份简历引用的 {entryUpdates.size.toString()} 条信息在信息库中更新过；简历不会自动同步，
        可在章节里重新检查后决定是否替换。
      </p>
    </Notice>
  )
}

export function FrozenNotice() {
  const resume = useResumeStore((state) => state.resume)
  if (resume?.status !== 'frozen' || resume.snapshots.length === 0) return null
  return (
    <Notice tone="info" title="已定稿">
      <p>
        快照创建于 {formatUpdatedAt(resume.snapshots[0]?.createdAt ?? resume.updatedAt)}，
        文档与修订历史已锁定。需要继续修改时，复制为一份新草稿。
      </p>
    </Notice>
  )
}
