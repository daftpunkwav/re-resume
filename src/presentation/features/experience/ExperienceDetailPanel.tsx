/**
 * @file ExperienceDetailPanel
 * @description The open experience: its facts on one tab, its wordings on the
 * next, its assertions on the third. The three are separate tabs because the
 * product keeps them apart — a rewrite of a description must never look like an
 * edit of the facts.
 *
 * Responsibilities:
 * - Load the selected experience and own the tab that is showing
 * - Hand one update path to the form and to the variant and claim panels
 * - Offer the empty form that creates the next experience
 *
 * Constraints:
 * - The aggregate a command returns replaces the loaded one instead of being
 *   refetched, so a confirmation does not race the list behind it.
 * - Nothing in this panel reads a repository or a use case directly.
 */

import { useState } from 'react'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { Panel } from '../../app/components/Panel'
import { Spinner } from '../../app/components/Spinner'
import { Tabs } from '../../app/components/Tabs'
import type { TabDescriptor } from '../../app/components/Tabs'
import { useNavigation } from '../../app/navigationStore'
import { useResource } from '../../app/useResource'
import type { ExperienceLibrary } from '../../../bootstrap/compositionRoot'
import type { Experience } from '../../../domain/catalog/Experience'
import { asExperienceId } from '../../../domain/shared/branded-id'
import { ClaimPanel } from './ClaimPanel'
import { ExperienceForm } from './ExperienceForm'
import { VariantPanel } from './VariantPanel'
import { EXPERIENCE_KIND_LABELS } from './experienceKindLabels'

type ExperienceTab = 'facts' | 'variants' | 'claims'

const EXPERIENCE_TABS: readonly TabDescriptor<ExperienceTab>[] = [
  { id: 'facts', label: '基本信息' },
  { id: 'variants', label: '表述' },
  { id: 'claims', label: '断言' },
]

interface SelectedExperienceProps {
  readonly library: ExperienceLibrary
  readonly experienceId: string
  readonly onListChanged: () => void | Promise<void>
}

function SelectedExperience({ library, experienceId, onListChanged }: SelectedExperienceProps) {
  const [tab, setTab] = useState<ExperienceTab>('facts')
  const experience = useResource(
    () => library.get(asExperienceId(experienceId)),
    [library, experienceId],
  )

  /**
   * One update path for every command, so no two tabs can end up showing
   * different rows for the same experience. A command that returns the
   * aggregate replaces the loaded one; one that returns nothing — a removal —
   * has to be re-read, because the row it removed is gone from the server too.
   */
  const applyChange = async (updated: Experience | null) => {
    if (updated === null) await experience.reload()
    else experience.set(updated)
    await onListChanged()
  }

  if (experience.loading) return <Spinner label="正在读取经历…" />

  if (experience.error !== null) {
    return (
      <Notice
        tone="danger"
        title={experience.error.message}
        actions={
          <Button size="small" onClick={() => void experience.reload()}>
            重试
          </Button>
        }
      />
    )
  }

  if (experience.data === null) {
    return (
      <EmptyState
        icon="alert"
        title="这条经历已经不在库里"
        description="它可能已经在另一个窗口中被删除。返回列表重新选择一条经历。"
      />
    )
  }

  const current = experience.data

  return (
    <Tabs tabs={EXPERIENCE_TABS} active={tab} onChange={setTab}>
      {tab === 'facts' ? (
        <div className="stack">
          <p className="experience-hint">
            {EXPERIENCE_KIND_LABELS[current.kind]}的事实资料。事实改动会让引用它的简历块提示过期，表述和断言不受影响。
          </p>
          <ExperienceForm
            key={`${current.id}-${current.factVersion}`}
            library={library}
            experience={current}
            onSaved={applyChange}
          />
        </div>
      ) : null}

      {tab === 'variants' ? (
        <VariantPanel
          library={library}
          experience={current}
          onChanged={applyChange}
        />
      ) : null}

      {tab === 'claims' ? (
        <ClaimPanel
          library={library}
          experience={current}
          onChanged={applyChange}
        />
      ) : null}
    </Tabs>
  )
}

export interface ExperienceDetailPanelProps {
  readonly library: ExperienceLibrary
  readonly onListChanged: () => void | Promise<void>
}

export function ExperienceDetailPanel({ library, onListChanged }: ExperienceDetailPanelProps) {
  const selectedExperienceId = useNavigation((state) => state.selectedExperienceId)
  const selectExperience = useNavigation((state) => state.selectExperience)
  const [creating, setCreating] = useState(false)

  // Create mode belongs to a moment with nothing selected: choosing a row in
  // the index is a decision to edit that row, so it ends the create form
  // rather than leaving the panel offering to record a new experience while
  // the chosen row sits ignored beside it. Clearing the flag here rather than
  // in an effect also means a later empty selection cannot resurrect a form
  // the user has already left.
  const showingCreate = creating && selectedExperienceId === null
  if (creating && selectedExperienceId !== null) {
    setCreating(false)
  }

  const startCreating = () => {
    selectExperience(null)
    setCreating(true)
  }

  const openExisting = (created: Experience) => {
    setCreating(false)
    selectExperience(created.id)
    return onListChanged()
  }

  return (
    <Panel
      title="经历详情"
      actions={
        !showingCreate && selectedExperienceId !== null ? (
          <Button size="small" icon="plus" onClick={startCreating}>
            新建经历
          </Button>
        ) : undefined
      }
    >
      {showingCreate ? (
        <div className="stack">
          <EmptyState
            icon="plus"
            title="记录一条新经历"
            description="先选类型，再填事实。表述和断言可以随后补充。"
            action={
              <Button variant="ghost" onClick={() => setCreating(false)}>
                取消
              </Button>
            }
          />
          <ExperienceForm library={library} experience={null} onSaved={openExisting} />
        </div>
      ) : null}

      {!showingCreate && selectedExperienceId === null ? (
        <EmptyState
          icon="library"
          title="选择一条经历"
          description="在左侧按类型挑一条经历，可以编辑它的事实、维护不同岗位的表述，并逐条核对它的断言。"
          action={
            <Button variant="primary" icon="plus" onClick={startCreating}>
              新建经历
            </Button>
          }
        />
      ) : null}

      {!showingCreate && selectedExperienceId !== null ? (
        <SelectedExperience
          library={library}
          experienceId={selectedExperienceId}
          onListChanged={onListChanged}
        />
      ) : null}
    </Panel>
  )
}
