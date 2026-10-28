/**
 * @file PageSetupPanel
 * @description Paper, margins, column count and page numbering. Column options
 * come from the template's own support set, so the control never offers a layout
 * the renderer cannot produce; the domain still validates every merge and a
 * refused value comes back as a readable notice.
 *
 * Constraints:
 * - Continuous controls (the four margins) debounce; discrete choices commit at
 *   once. Both paths go through the same `setPageSetup` use case.
 */

import { useState } from 'react'

import { PAPER_SIZES } from '../../../domain/resume/PageSetup'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import { getTemplate } from '../../../domain/resume/Template'
import { SegmentedControl } from '../../app/components/SegmentedControl'
import { Slider } from '../../app/components/Slider'
import { Switch } from '../../app/components/Switch'
import { PAPER_LABELS } from './resumeFormat'
import { useResumeStore } from './resumeStore'
import { useDebouncedCommit } from './useDebouncedCommit'

const PAPER_OPTIONS = PAPER_SIZES.map((paper) => ({
  id: paper,
  label: PAPER_LABELS[paper],
}))

const MARGIN_FIELDS = [
  { key: 'marginTop', label: '上边距' },
  { key: 'marginRight', label: '右边距' },
  { key: 'marginBottom', label: '下边距' },
  { key: 'marginLeft', label: '左边距' },
] as const

function points(value: number): string {
  return `${Math.round(value).toString()} pt`
}

export function PageSetupPanel() {
  const resume = useResumeStore((state) => state.resume)
  const committing = useResumeStore((state) => state.committing)
  const setPageSetup = useResumeStore((state) => state.setPageSetup)
  const debounce = useDebouncedCommit()
  // A slider gesture is shown immediately and committed when it settles; only
  // the patch lives here, so a fresh render of the resume needs no copy effect.
  const [override, setOverride] = useState<Partial<PageSetup>>({})

  if (resume === null) return null
  const frozen = resume.status === 'frozen'
  const disabled = frozen || committing
  const draft: PageSetup = { ...resume.document.pageSetup, ...override }
  const template = getTemplate(resume.document.templateId)
  const supportedColumns = template?.supports.columns ?? [1]
  const columnOptions = supportedColumns.map((columns) => ({
    id: columns.toString() as '1' | '2',
    label: columns === 1 ? '单栏' : '双栏',
  }))
  const columnHint =
    supportedColumns.length === 1
      ? `当前模板只支持${supportedColumns[0] === 1 ? '单栏' : '双栏'}，切换模板后可选择其它栏数。`
      : '栏数受模板支持，内容不会因栏数变化而丢失。'

  const settle = (patch: Partial<PageSetup>, accepted: boolean): void => {
    const persisted = useResumeStore.getState().resume?.document.pageSetup
    setOverride((current) => {
      if (!accepted || persisted === undefined) return {}
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof PageSetup)[]) {
        if (next[key] === patch[key]) delete next[key]
      }
      return next
    })
  }

  const apply = (patch: Partial<PageSetup>): void => {
    setOverride((current) => ({ ...current, ...patch }))
    const commit = (): void => {
      void setPageSetup(patch).then((accepted) => settle(patch, accepted))
    }
    if ('marginTop' in patch || 'marginRight' in patch || 'marginBottom' in patch || 'marginLeft' in patch) {
      debounce(commit)
    } else {
      commit()
    }
  }

  return (
    <div className="studio-stack">
      <div className="studio-section-head">
        <h3 className="studio-subtitle">页面</h3>
        <p className="studio-hint">纸张决定页面尺寸；边距是内容到纸边的距离（24–144 pt）。</p>
      </div>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">纸型</legend>
        <SegmentedControl
          label="纸张大小"
          options={PAPER_OPTIONS}
          value={draft.paper}
          onChange={(paper) => apply({ paper })}
        />
      </fieldset>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">栏数</legend>
        <SegmentedControl
          label="页面栏数"
          options={columnOptions}
          value={draft.columns.toString() as '1' | '2'}
          onChange={(value) => apply({ columns: value === '2' ? 2 : 1 })}
        />
        <p className="studio-hint">{columnHint}</p>
      </fieldset>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">页边距</legend>
        {MARGIN_FIELDS.map((field) => (
          <Slider
            key={field.key}
            label={field.label}
            value={draft[field.key]}
            min={24}
            max={144}
            step={4}
            formatValue={points}
            onChange={(value) => apply({ [field.key]: value })}
          />
        ))}
      </fieldset>

      <Switch
        label="显示页码"
        description="在每页底部居中显示「第 N 页 / 共 M 页」。"
        checked={draft.showPageNumber}
        disabled={disabled}
        onChange={(checked) => apply({ showPageNumber: checked })}
      />
    </div>
  )
}
