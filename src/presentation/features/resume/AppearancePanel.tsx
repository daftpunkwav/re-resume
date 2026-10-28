/**
 * @file AppearancePanel
 * @description The resume's own look: accent colour, heading style, font scale,
 * line height and section spacing. Controls write through the store, which
 * debounces the continuous ones, so dragging a slider produces one revision
 * when the hand stops instead of hundreds while it moves.
 *
 * Constraints:
 * - This palette is the resume's, not the interface's. The heading carries a
 *   note saying so, because two accent pickers in the same window are otherwise
 *   indistinguishable.
 */

import { useState } from 'react'

import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import { ACCENT_COLORS, HEADING_STYLES } from '../../../domain/resume/AppearanceSettings'
import { SegmentedControl } from '../../app/components/SegmentedControl'
import { Slider } from '../../app/components/Slider'
import {
  ACCENT_SWATCHES,
  HEADING_STYLE_LABELS,
} from './resumeFormat'
import { useResumeStore } from './resumeStore'
import { TemplateGallery } from './TemplateGallery'
import { useDebouncedCommit } from './useDebouncedCommit'

const HEADING_OPTIONS = HEADING_STYLES.map((style) => ({
  id: style,
  label: HEADING_STYLE_LABELS[style],
}))

function percent(value: number): string {
  return `${Math.round(value * 100).toString()}%`
}

function points(value: number): string {
  return `${Math.round(value).toString()} pt`
}

export function AppearancePanel() {
  const resume = useResumeStore((state) => state.resume)
  const committing = useResumeStore((state) => state.committing)
  const setAppearance = useResumeStore((state) => state.setAppearance)
  const debounce = useDebouncedCommit()
  // The visible value is the persisted appearance with the gesture's patch on
  // top. Keeping only the patch means a refresh of the resume never has to be
  // copied into local state from an effect.
  const [override, setOverride] = useState<Partial<AppearanceSettings>>({})

  if (resume === null) return null
  const frozen = resume.status === 'frozen'
  const disabled = frozen || committing
  const draft: AppearanceSettings = { ...resume.document.appearance, ...override }

  /**
   * Drops the keys the store has caught up with, or all of them when the write
   * was refused (the persisted value is the truth again).
   */
  const settle = (patch: Partial<AppearanceSettings>, accepted: boolean): void => {
    const persisted = useResumeStore.getState().resume?.document.appearance
    setOverride((current) => {
      if (!accepted || persisted === undefined) return {}
      const next = { ...current }
      for (const key of Object.keys(patch) as (keyof AppearanceSettings)[]) {
        if (next[key] === patch[key]) delete next[key]
      }
      return next
    })
  }

  const commitLater = (patch: Partial<AppearanceSettings>): void => {
    setOverride((current) => ({ ...current, ...patch }))
    debounce(() => {
      void setAppearance(patch).then((accepted) => settle(patch, accepted))
    })
  }

  const commitNow = (patch: Partial<AppearanceSettings>): void => {
    setOverride((current) => ({ ...current, ...patch }))
    void setAppearance(patch).then((accepted) => settle(patch, accepted))
  }

  return (
    <div className="studio-stack">
      <TemplateGallery />

      <div className="studio-divider" />

      <div className="studio-section-head">
        <h3 className="studio-subtitle">外观</h3>
        <p className="studio-hint">这里的强调色只影响简历本身，界面强调色在设置里。</p>
      </div>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">强调色</legend>
        <div className="accent-swatches" role="radiogroup" aria-label="简历强调色">
          {ACCENT_SWATCHES.map((swatch) => {
            const selected = draft.accentColor === swatch.id
            return (
              <button
                key={swatch.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={swatch.label}
                title={swatch.label}
                className={selected ? 'accent-swatch accent-swatch-selected' : 'accent-swatch'}
                style={{ background: swatch.hex }}
                onClick={() => commitNow({ accentColor: swatch.id })}
              >
                {selected ? <span className="accent-swatch-check">✓</span> : null}
              </button>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">标题样式</legend>
        <SegmentedControl
          label="章节标题样式"
          options={HEADING_OPTIONS}
          value={draft.headingStyle}
          onChange={(style) => commitNow({ headingStyle: style })}
        />
      </fieldset>

      <fieldset className="studio-fieldset" disabled={disabled}>
        <legend className="studio-legend">排版</legend>
        <Slider
          label="字号缩放"
          value={draft.fontScale}
          min={0.85}
          max={1.25}
          step={0.05}
          formatValue={percent}
          onChange={(value) => commitLater({ fontScale: value })}
        />
        <Slider
          label="行高"
          value={draft.lineHeight}
          min={1.15}
          max={2}
          step={0.05}
          formatValue={(value) => value.toFixed(2)}
          onChange={(value) => commitLater({ lineHeight: value })}
        />
        <Slider
          label="章节间距"
          value={draft.sectionSpacing}
          min={8}
          max={48}
          step={1}
          formatValue={points}
          onChange={(value) => commitLater({ sectionSpacing: value })}
        />
      </fieldset>

      <div className="studio-note">
        <span className="studio-note-title">字体</span>
        <span className="studio-note-body">
          内置 Noto Sans SC（当前字族）。字号缩放只改变文字大小，不改变页边距。
        </span>
      </div>

      <p className="studio-hint studio-palette-note">
        可用强调色：{ACCENT_COLORS.length} 种；文字颜色保持正文纯黑，强调色用于标题线与链接。
      </p>
    </div>
  )
}
