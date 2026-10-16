/**
 * @file ClaimPanel
 * @description The checkable assertions of one experience. Each row states what
 * the assertion says and where it stands, because a number that has not been
 * checked has to be visibly distinct from one that has.
 *
 * Responsibilities:
 * - List the assertions with their status and the fact field they derive from
 * - Move one assertion along the lifecycle the aggregate allows
 * - Record a new assertion, always as pending
 *
 * Constraints:
 * - There is no delete. The lifecycle ends at rejected, and a wording the user
 *   no longer stands behind is rejected rather than removed.
 * - A transition the aggregate refuses is reported where it was clicked; the
 *   panel never hides an action by guessing the current state ahead of time.
 */

import { useState } from 'react'
import { Badge } from '../../app/components/Badge'
import type { BadgeTone } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { SelectField } from '../../app/components/SelectField'
import type { SelectOption } from '../../app/components/SelectField'
import { TextAreaField } from '../../app/components/TextAreaField'
import { TextField } from '../../app/components/TextField'
import { useOperation } from '../../app/useOperation'
import type { ExperienceLibrary } from '../../../bootstrap/compositionRoot'
import type { Claim } from '../../../domain/catalog/Claim'
import { CLAIM_KINDS } from '../../../domain/catalog/ClaimKind'
import type { ClaimKind } from '../../../domain/catalog/ClaimKind'
import type { ClaimStatus } from '../../../domain/catalog/ClaimStatus'
import type { Experience } from '../../../domain/catalog/Experience'
import {
  CLAIM_KIND_LABELS,
  CLAIM_STATUS_LABELS,
  describeCommandFailure,
} from './experienceKindLabels'

const STATUS_TONES: Readonly<Record<ClaimStatus, BadgeTone>> = {
  confirmed: 'success',
  pending: 'warning',
  rejected: 'danger',
}

const KIND_OPTIONS: readonly SelectOption[] = CLAIM_KINDS.map((kind) => ({
  value: kind,
  label: CLAIM_KIND_LABELS[kind],
}))

interface ClaimRowProps {
  readonly library: ExperienceLibrary
  readonly experience: Experience
  readonly claim: Claim
  readonly onChanged: (updated: Experience) => void | Promise<void>
}

function ClaimRow({ library, experience, claim, onChanged }: ClaimRowProps) {
  const confirm = useOperation(async () => {
    await onChanged(await library.confirmClaim(experience.id, claim.id))
  })

  const reject = useOperation(async () => {
    await onChanged(await library.rejectClaim(experience.id, claim.id))
  })

  const reopen = useOperation(async () => {
    await onChanged(await library.reopenClaim(experience.id, claim.id))
  })

  const failure = confirm.error ?? reject.error ?? reopen.error
  const actions =
    claim.status === 'rejected'
      ? [
          {
            key: 'reopen',
            label: '重新开启',
            icon: 'undo' as const,
            busy: reopen.busy,
            run: () => void reopen.run(),
          },
        ]
      : [
          ...(claim.status === 'pending'
            ? [
                {
                  key: 'confirm',
                  label: '确认',
                  icon: 'check' as const,
                  busy: confirm.busy,
                  run: () => void confirm.run(),
                },
              ]
            : []),
          {
            key: 'reject',
            label: '拒绝',
            icon: 'close' as const,
            busy: reject.busy,
            run: () => void reject.run(),
          },
        ]

  return (
    <li className={`experience-row claim-row claim-row-${claim.status}`}>
      <div className="list-row-body">
        <div className="experience-row-head">
          <Badge tone={STATUS_TONES[claim.status]}>{CLAIM_STATUS_LABELS[claim.status]}</Badge>
          <span className="claim-kind">{CLAIM_KIND_LABELS[claim.kind]}</span>
        </div>
        <p className="claim-statement">{claim.statement}</p>
        {claim.sourceField === null ? null : (
          <p className="list-row-meta">来源字段：{claim.sourceField}</p>
        )}
      </div>
      <div className="experience-row-actions">
        {actions.map((action) => (
          <Button
            key={action.key}
            size="small"
            icon={action.icon}
            disabled={action.busy}
            onClick={action.run}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {failure === null ? null : <Notice tone="danger" title={failure.message} />}
    </li>
  )
}

export interface ClaimPanelProps {
  readonly library: ExperienceLibrary
  readonly experience: Experience
  readonly onChanged: (updated: Experience) => void | Promise<void>
}

export function ClaimPanel({ library, experience, onChanged }: ClaimPanelProps) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<ClaimKind>('metric')
  const [statement, setStatement] = useState('')
  const [sourceField, setSourceField] = useState('')

  const add = useOperation(async () => {
    const result = await library.addClaim({
      experienceId: experience.id,
      kind,
      statement: statement.trim(),
      sourceField: sourceField.trim() === '' ? null : sourceField.trim(),
    })
    if (!result.ok) throw new Error(describeCommandFailure(result.error))
    await onChanged(result.value)
    setAdding(false)
    setStatement('')
    setSourceField('')
  })

  const pendingCount = experience.claims.filter((claim) => claim.status === 'pending').length

  return (
    <div className="stack">
      <div className="toolbar experience-toolbar">
        <p className="experience-hint">
          量化数据、职责归属和技能声明各自成条。存在待确认断言时，这份经历不能定稿为正式版本。
        </p>
        <div className="toolbar-group">
          {pendingCount === 0 ? null : <Badge tone="warning">{pendingCount} 条待确认</Badge>}
          <Button
            size="small"
            icon="plus"
            disabled={adding}
            onClick={() => {
              add.clearError()
              setAdding(true)
            }}
          >
            新建断言
          </Button>
        </div>
      </div>

      {adding ? (
        <div className="stack experience-editor">
          <SelectField
            label="断言类型"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(event) => setKind(event.target.value as ClaimKind)}
          />
          <TextAreaField
            label="断言内容"
            rows={3}
            hint="确认后这份说法就可以被简历引用"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
          />
          <TextField
            label="来源字段"
            hint="可选，指向这条断言依据的事实字段"
            value={sourceField}
            onChange={(event) => setSourceField(event.target.value)}
          />
          {add.error === null ? null : <Notice tone="danger" title={add.error.message} />}
          <div className="experience-form-actions">
            <Button
              variant="ghost"
              disabled={add.busy}
              onClick={() => {
                add.clearError()
                setAdding(false)
              }}
            >
              取消
            </Button>
            <Button variant="primary" disabled={add.busy} onClick={() => void add.run()}>
              记录断言
            </Button>
          </div>
        </div>
      ) : null}

      {experience.claims.length === 0 ? (
        <EmptyState
          icon="check"
          title="还没有断言"
          description="把简历里会出现的数字和职责写下来并逐条确认，未确认的内容不会伪装成事实。"
        />
      ) : (
        <ul className="experience-rows">
          {experience.claims.map((claim) => (
            <ClaimRow
              key={claim.id}
              library={library}
              experience={experience}
              claim={claim}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
