/**
 * @file InteractionSection
 * @description Interface scale and the shortcut list. The scale is the same
 * value the keyboard shortcuts change, so the slider and the keys can never
 * disagree.
 */

import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
} from '../../../domain/settings/AppSettings'
import { Button } from '../components/Button'
import { ShortcutKeys, primaryModifierLabel } from '../components/Kbd'
import { Slider } from '../components/Slider'
import { useSettingsStore } from '../stores/settingsStore'

interface ShortcutRow {
  readonly keys: readonly string[]
  readonly label: string
}

export function InteractionSection() {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const modifier = primaryModifierLabel()

  const shortcuts: readonly ShortcutRow[] = [
    { keys: [modifier, 'N'], label: '新建对话' },
    { keys: [modifier, '1'], label: '聚焦侧边栏' },
    { keys: [modifier, '2'], label: '聚焦对话' },
    { keys: [modifier, '3'], label: '聚焦右侧面板' },
    { keys: [modifier, ','], label: '打开或关闭设置' },
    { keys: [modifier, 'B'], label: '显示或隐藏右侧面板' },
    { keys: [modifier, '+'], label: '放大界面' },
    { keys: [modifier, '−'], label: '缩小界面' },
    { keys: [modifier, '0'], label: '缩放复位到 100%' },
    { keys: ['Esc'], label: '关闭覆盖层、抽屉或弹层' },
  ]

  return (
    <div className="settings-section">
      <section className="settings-group">
        <h3 className="settings-group-title">界面缩放</h3>
        <p className="settings-group-description">
          缩放整个界面，范围 {Math.round(UI_SCALE_MIN * 100)}%–{Math.round(UI_SCALE_MAX * 100)}
          %，实时生效并记住。
        </p>
        <Slider
          label="界面缩放"
          value={settings.uiScale}
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          onChange={(uiScale) => update({ uiScale })}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          description={`快捷键 ${modifier} + + / − / 0 也可以调整。`}
        />
        <div className="settings-inline-actions">
          <Button size="small" variant="secondary" onClick={() => update({ uiScale: 1 })}>
            复位到 100%
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">快捷键</h3>
        <p className="settings-group-description">
          在输入框内输入时快捷键让给输入法；组合输入期间不会触发。
        </p>
        <dl className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div className="shortcut-row" key={shortcut.label}>
              <dt className="shortcut-label">{shortcut.label}</dt>
              <dd>
                <ShortcutKeys keys={shortcut.keys} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
