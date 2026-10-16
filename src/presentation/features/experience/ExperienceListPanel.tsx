/**
 * @file ExperienceListPanel
 * @description The catalog index: every experience grouped by kind, filtered by
 * the words a user remembers about it, and the entry point for deleting one.
 *
 * Responsibilities:
 * - Group the library by kind under a label that stays put while the list scrolls
 * - Narrow the list on title, organization and the kind-specific detail values
 * - Delete an experience behind a dialog that names the resume blocks refusing it
 *
 * Constraints:
 * - Selection belongs to the navigation store, so the sidebar and this pane can
 *   never disagree about which experience is open.
 * - A refused deletion keeps its dialog open: the user has to read which resume
 *   still points at the record before dismissing anything.
 */

import { useState } from 'react'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { Panel } from '../../app/components/Panel'
import { Spinner } from '../../app/components/Spinner'
import { TextField } from '../../app/components/TextField'
import { useNavigation } from '../../app/navigationStore'
import { useOperation } from '../../app/useOperation'
import type { Resource } from '../../app/useResource'
import type { ExperienceLibrary } from '../../../bootstrap/compositionRoot'
import type { Experience } from '../../../domain/catalog/Experience'
import { EXPERIENCE_KINDS } from '../../../domain/catalog/ExperienceKind'
import { EXPERIENCE_KIND_LABELS } from './experienceKindLabels'

function detailTextOf(experience: Experience): string {
  const values = Object.values(experience.detail).flatMap((value) =>
    Array.isArray(value) ? value : [value],
  )
  return values.map((value) => String(value)).join(' ')
}

/**
 * Matches on the words a user would actually type: what it is called, where it
 * happened, and the kind-specific values that only appear once a row is open.
 */
function matchesQuery(experience: Experience, query: string): boolean {
  if (query === '') return true
  const haystack = `${experience.title} ${experience.organization ?? ''} ${detailTextOf(experience)}`
  return haystack.toLowerCase().includes(query)
}

export interface ExperienceListPanelProps {
  readonly library: ExperienceLibrary
  readonly experiences: Resource<readonly Experience[]>
  /** Called with the removed id so the selection does not outlive the row. */
  readonly onRemoved: (removedId: string) => void
}

export function ExperienceListPanel({ library, experiences, onRemoved }: ExperienceListPanelProps) {
  const selectedExperienceId = useNavigation((state) => state.selectedExperienceId)
  const selectExperience = useNavigation((state) => state.selectExperience)
  const [query, setQuery] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<Experience | null>(null)

  const remove = useOperation(async () => {
    if (pendingRemoval === null) return
    await library.remove(pendingRemoval.id)
    onRemoved(pendingRemoval.id)
    setPendingRemoval(null)
  }, experiences.reload)

  const normalized = query.trim().toLowerCase()
  const visible = (experiences.data ?? []).filter((experience) =>
    matchesQuery(experience, normalized),
  )
  const groups = EXPERIENCE_KINDS.map((kind) => ({
    kind,
    items: visible.filter((experience) => experience.kind === kind),
  })).filter((group) => group.items.length > 0)

  const blockers = remove.error?.blockers ?? []
  const total = experiences.data?.length ?? 0

  return (
    <Panel flush title={`经历库（${total}）`}>
      <div className="toolbar">
        <TextField
          label="搜索经历"
          placeholder="标题、单位或详情内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {experiences.error === null ? null : (
        <Notice
          tone="danger"
          title={experiences.error.message}
          actions={
            <Button size="small" onClick={() => void experiences.reload()}>
              重试
            </Button>
          }
        />
      )}

      {experiences.loading ? <Spinner label="正在读取经历库…" /> : null}

      {!experiences.loading && total === 0 && experiences.error === null ? (
        <EmptyState
          icon="library"
          title="经历库还是空的"
          description="先把教育、工作、项目、获奖、技能和评价分别记录下来，之后每一份简历都从这里取用。"
        />
      ) : null}

      {!experiences.loading && total > 0 && groups.length === 0 ? (
        <EmptyState
          icon="search"
          title="没有匹配的经历"
          description={`没有经历包含「${query.trim()}」。换一个词，或清空搜索框看全部。`}
        />
      ) : null}

      <div className="experience-groups">
        {groups.map((group) => (
          <section key={group.kind} className="experience-group">
            <h3 className="experience-group-label">{EXPERIENCE_KIND_LABELS[group.kind]}</h3>
            {group.items.map((experience) => {
              const active = experience.id === selectedExperienceId
              return (
                <div
                  key={experience.id}
                  className={active ? 'list-row list-row-active' : 'list-row'}
                >
                  <button
                    type="button"
                    className="experience-row-select"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => selectExperience(experience.id)}
                  >
                    <span className="list-row-body">
                      <span className="list-row-title">{experience.title}</span>
                      <span className="list-row-meta">
                        {experience.organization === null ? null : (
                          <span>{experience.organization}</span>
                        )}
                        <span>{experience.variants.length} 条表述</span>
                        <span>{experience.claims.length} 条断言</span>
                      </span>
                    </span>
                  </button>
                  <Button
                    size="small"
                    variant="ghost"
                    iconOnly
                    icon="trash"
                    aria-label={`删除 ${experience.title}`}
                    onClick={() => {
                      remove.clearError()
                      setPendingRemoval(experience)
                    }}
                  >
                    {null}
                  </Button>
                </div>
              )
            })}
          </section>
        ))}
      </div>

      <Dialog
        open={pendingRemoval !== null}
        title={`删除经历「${pendingRemoval?.title ?? ''}」`}
        description="删除后，这条经历的表述和断言会一并移除，无法撤销。引用了它的简历块需要先解除引用。"
        confirmLabel="删除"
        destructive
        busy={remove.busy}
        onConfirm={() => void remove.run()}
        onClose={() => setPendingRemoval(null)}
      >
        {remove.error === null ? null : (
          <Notice tone="danger" title={remove.error.message}>
            {blockers.length === 0 ? null : (
              <>
                <p>下列简历块仍然引用它：</p>
                <ul className="experience-blockers">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        )}
      </Dialog>
    </Panel>
  )
}
